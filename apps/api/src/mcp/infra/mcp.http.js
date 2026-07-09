import crypto from 'node:crypto'
import { InMemoryMcpRateLimiter } from './InMemoryMcpRateLimiter.js'
import { provideTools } from './provideTools.js'
import { sanitizeParamsForAudit } from '../app/SafeResponse.js'

/**
 * mcp.http.js — Streamable HTTP transport for the Model Context Protocol.
 *
 * Exposes a single endpoint `POST /mcp` (and `GET /mcp` returning 405).
 * Speaks JSON-RPC 2.0 over HTTP, the same wire protocol that stdio
 * MCP servers use, but addressed by URL + Bearer token instead of
 * stdin/stdout subprocess. Backed by the same Mongo repos the rest
 * of the API uses — no new storage, no new process (apart from the
 * `mcp_audit_log` collection, which is append-only and best-effort).
 *
 * Auth: `Authorization: Bearer <mcp_token>`. The plaintext token is
 * hashed (SHA-256 hex) and looked up in the existing `inboxes`
 * collection. The token scopes every tool call to its inbox; tools no
 * longer take `inbox_token`/`mcp_token` in their arguments.
 *
 * Security (per spec MCP "Streamable HTTP"):
 *   - Origin header is validated against the same allowlist used by
 *     the rest of the API (CORS `WEB_URL`). A missing Origin (curl,
 *     server-side callers) is allowed; an unknown one is rejected
 *     with 403.
 *   - `localhost` / `127.0.0.1` are always accepted as Origin to keep
 *     local Claude / Cursor / Cline clients usable without extra
 *     config.
 *
 * Security (peekhook additions, applied to the MCP layer):
 *   - Per-token rate limit: 10 calls / 60s, sliding window, keyed on
 *     the SHA-256 hash of the bearer token. Exceeded calls return
 *     429 + `Retry-After: <seconds>`. The limit is checked AFTER auth
 *     and BEFORE tool dispatch — rate-limited calls do not touch
 *     the read models or use cases.
 *   - Audit log: every authenticated `tools/call` is appended to
 *     `mcp_audit_log` with `{ tokenHash, tool, params, ip, timestamp }`.
 *     Params are size-capped (any string > 1 KB → `{ length }` shape)
 *     so an attacker cannot stash a payload in a tool argument. The
 *     write is best-effort: a Mongo failure logs to stderr and the
 *     MCP call still succeeds.
 *
 * Lifecycle: `initialize` returns a minimal handshake result; client
 * `notifications/initialized` returns 202. The session itself is
 * stateless — every request is independent and re-authenticates via
 * the Bearer header. Streamable HTTP allows this per spec (servers
 * "MAY" use session IDs; they are not required).
 *
 * Errors follow the JSON-RPC error-codes table (-32700 parse,
 * -32600 invalid request, -32601 method not found, -32602 invalid
 * params, -32603 internal error, -32000 tool execution, -32001 auth).
 * 4xx is reserved for transport-level issues (auth, bad accept
 * header, rate-limit).
 *
 * @param {import('fastify').FastifyInstance} fastify
 * @param {{
 *   mcpRateLimiter:     import('../domain/McpRateLimiter.js').McpRateLimiter,
 *   mcpAuditLog:        import('../domain/McpAuditLog.js').McpAuditLog,
 *   mcpAuth:            import('../domain/McpAuthRepository.js').McpAuthRepository,
 *   requestReadModel:   import('../../inbox/domain/RequestListReadModel.js').RequestListReadModel,
 *   mcpSearchReadModel: import('../domain/RequestSearchReadModel.js').RequestSearchReadModel,
 * }} deps Required injection. Production wires Mongo adapters via
 *   `buildApp({ mcpAuth, requestReadModel, mcpSearchReadModel, mcpAuditLog, mcpRateLimiter })`;
 *   the local SQLite entry point (`cli.js`) wires the SQLite adapters.
 *   No storage-agnostic fallback — every backend passes its own deps.
 */
export async function registerMcpRoutes(fastify, deps = {}) {
  const allowedOrigin = (() => {
    const fromEnv = process.env.WEB_URL || 'http://localhost:5173'
    try { return new URL(fromEnv).origin } catch { return null }
  })()

  const {
    mcpRateLimiter,
    mcpAuditLog,
    mcpAuth,
    requestReadModel,
    mcpSearchReadModel,
  } = deps
  const auditLog    = mcpAuditLog
  const rateLimiter = mcpRateLimiter
  if (!rateLimiter || !auditLog || !mcpAuth || !requestReadModel || !mcpSearchReadModel) {
    throw new Error(
      'registerMcpRoutes: mcpRateLimiter, mcpAuditLog, mcpAuth, requestReadModel, mcpSearchReadModel are all required',
    )
  }

  fastify.addContentTypeParser('application/json', { parseAs: 'string' }, (_req, body, done) => {
    done(null, body)
  })

  fastify.post('/mcp', async (request, reply) => {
    let msg
    if (typeof request.body !== 'string' || request.body.length === 0) {
      return reply.code(400).send({
        jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error: empty body' },
      })
    }
    try {
      msg = JSON.parse(request.body)
    } catch (_err) {
      return reply.code(400).send({
        jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' },
      })
    }
    if (typeof msg !== 'object' || msg === null) {
      return reply.code(400).send({
        jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error: not a JSON object' },
      })
    }
    if (!isAcceptable(request.headers.accept)) {
      return reply.code(406).send({
        jsonrpc: '2.0',
        id: null,
        error: { code: -32600, message: 'Accept header must include application/json and/or text/event-stream' },
      })
    }

    if (!originAllowed(request.headers.origin, allowedOrigin)) {
      return reply.code(403).send({ error: 'Origin not allowed' })
    }

    if (msg.jsonrpc !== '2.0') {
      return reply.send({
        jsonrpc: '2.0', id: msg.id ?? null, error: { code: -32600, message: 'Invalid Request' },
      })
    }

    const id     = msg.id ?? null
    const method = msg.method
    const params = msg.params ?? {}

    if (typeof method === 'string' && method.startsWith('notifications/')) {
      return reply.code(202).send()
    }

    const auth = await resolveAuth(request.headers.authorization, mcpAuth)
    if (!auth.ok) {
      return reply
        .code(401)
        .header('WWW-Authenticate', 'Bearer realm="peekhook"')
        .send({ jsonrpc: '2.0', id, error: { code: -32001, message: auth.reason } })
    }

    // Per-token rate limit. Keyed on the SHA-256 hash so the plaintext
    // token never reaches the limiter. Applied BEFORE tool dispatch so
    // a denied call does not touch the read models or use cases.
    const limited = await rateLimiter.tryConsume({ tokenHash: auth.tokenHash })
    if (!limited.allowed) {
      return reply
        .code(429)
        .header('Retry-After', String(limited.retryAfterSec))
        .header('X-RateLimit-Reset', String(limited.retryAfterSec))
        .send({
          jsonrpc: '2.0', id,
          error: { code: -32002, message: `rate limit exceeded; retry in ${limited.retryAfterSec}s` },
        })
    }

    const surface = provideTools({ readModel: requestReadModel, searchModel: mcpSearchReadModel })

    if (method === 'initialize') {
      return reply.send({
        jsonrpc: '2.0',
        id,
        result: {
          protocolVersion: '2025-06-18',
          capabilities:    { tools: { listChanged: false } },
          serverInfo:      { name: 'peekhook', version: '1.0.0' },
        },
      })
    }

    if (method === 'tools/list') {
      return reply.send({ jsonrpc: '2.0', id, result: { tools: surface.listTools() } })
    }

    if (method === 'tools/call') {
      const name = params?.name
      const args = params?.arguments ?? {}
      if (typeof name !== 'string' || name.length === 0) {
        return reply.send({
          jsonrpc: '2.0', id, error: { code: -32602, message: 'params.name is required' },
        })
      }

      // Best-effort audit. Captures the intent before execution; a
      // tool failure still leaves a row in the audit log. A failing
      // audit must NEVER fail the MCP call — even if the
      // implementation forgets to swallow (e.g. a custom in-memory
      // stub that throws), the transport catches and proceeds.
      try {
        await auditLog.append({
          tokenHash: auth.tokenHash,
          tool:      name,
          params:    sanitizeParamsForAudit(args),
          ip:        request.ip,
          timestamp: new Date(),
        })
      } catch (auditErr) {
        request.log.warn({ err: auditErr && auditErr.message }, 'mcp audit log write failed')
      }

      try {
        const result = await surface.callTool(name, args, { inboxToken: auth.inboxToken })
        return reply.send({ jsonrpc: '2.0', id, result: wrapToolResult(result) })
      } catch (err) {
        const message = err && err.message ? err.message : 'tool execution failed'
        return reply.send({ jsonrpc: '2.0', id, error: { code: -32000, message } })
      }
    }

    if (typeof method !== 'string') {
      return reply.send({ jsonrpc: '2.0', id, error: { code: -32600, message: 'Invalid Request' } })
    }

    return reply.send({ jsonrpc: '2.0', id, error: { code: -32601, message: `Method not found: ${method}` } })
  })

  fastify.get('/mcp', async (_request, reply) => {
    return reply.code(405).header('Allow', 'POST').send({ error: 'GET not supported; use POST with JSON-RPC 2.0' })
  })
}

/**
 * Per spec, MCP clients MUST send `Accept` listing both
 * `application/json` and `text/event-stream` (or the catch-all media
 * range). Be lenient here — most clients send both; if the header is
 * missing or matches either, accept the call.
 */
function isAcceptable(accept) {
  if (typeof accept !== 'string' || accept.length === 0) return true
  const lowered = accept.toLowerCase()
  return lowered.includes('application/json')
    || lowered.includes('text/event-stream')
    || lowered.includes('*' + '/' + '*')
}

function originAllowed(origin, configured) {
  if (!origin || origin === 'null') return true
  if (origin === configured) return true
  try {
    const u = new URL(origin)
    if (u.protocol === 'http:' && (u.hostname === 'localhost' || u.hostname === '127.0.0.1')) return true
  } catch { /* not a URL — fall through */ }
  return false
}

/**
 * Resolve `Authorization: Bearer <token>` into the inbox that owns
 * this mcp_token. Returns `{ ok: true, inboxToken, tokenHash }` on
 * success or `{ ok: false, reason }` on every failure mode (missing
 * header, malformed header, unknown token). Hashed once on the
 * request path so the plaintext never leaves the inbound boundary.
 * `tokenHash` is the key used by both the rate limiter and the audit
 * log — neither ever sees the plaintext.
 *
 * @param {string|undefined} authorizationHeader
 * @param {import('../domain/McpAuthRepository.js').McpAuthRepository} authRepo
 */
async function resolveAuth(authorizationHeader, authRepo) {
  if (typeof authorizationHeader !== 'string' || authorizationHeader.length === 0) {
    return { ok: false, reason: 'missing Authorization: Bearer <token> header' }
  }
  const m = authorizationHeader.match(/^Bearer\s+(.+)$/i)
  if (!m) return { ok: false, reason: 'Authorization must be "Bearer <token>"' }
  const candidate = m[1].trim()
  if (candidate.length === 0) return { ok: false, reason: 'Bearer token is empty' }

  const hashHex = crypto.createHash('sha256').update(candidate).digest('hex')
  const inbox   = await authRepo.findByMcpTokenHash(hashHex)
  if (!inbox) return { ok: false, reason: 'invalid token' }
  if (!inbox.token) return { ok: false, reason: 'token resolves to an inbox without an id' }
  return { ok: true, inboxToken: inbox.token, tokenHash: hashHex }
}

/**
 * Wrap a tool's plain object result in the MCP wire envelope
 * (`content` + `structuredContent`). Both fields are present: the
 * `content` TextContent block carries the serialised JSON for
 * backwards compatibility, and `structuredContent` carries the
 * parsed object so clients that support it (Claude Code, Cursor,
 * Cline) get typed access without re-parsing.
 */
function wrapToolResult(result) {
  if (result && typeof result === 'object' && Array.isArray(result.content)) {
    return result
  }
  const text   = typeof result === 'string' ? result : JSON.stringify(result ?? null, null, 2)
  const structured = result && typeof result === 'object' ? result : null
  return {
    content: [{ type: 'text', text }],
    ...(structured ? { structuredContent: structured } : {}),
  }
}

export default registerMcpRoutes