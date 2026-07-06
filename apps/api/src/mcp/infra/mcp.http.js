import crypto from 'node:crypto'
import { getDb } from '../../shared/db.js'
import { MongoMcpAuthRepository } from './MongoMcpAuthRepository.js'
import { MongoRequestListReadModel } from '../../inbox/infra/persistence/MongoRequestListReadModel.js'
import { MongoRequestSearchReadModel } from './MongoRequestSearchReadModel.js'
import { provideTools } from './provideTools.js'

/**
 * mcp.http.js — Streamable HTTP transport for the Model Context Protocol.
 *
 * Exposes a single endpoint `POST /mcp` (and `GET /mcp` returning 405).
 * Speaks JSON-RPC 2.0 over HTTP, the same wire protocol that stdio
 * MCP servers use, but addressed by URL + Bearer token instead of
 * stdin/stdout subprocess. Backed by the same Mongo repos the rest
 * of the API uses — no new storage, no new process. Tools are the
 * exact same handlers (list_events / get_event / search_events /
 * diff_events / explain_event) that the previous stdio server wired.
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
 * header).
 *
 * @param {import('fastify').FastifyInstance} fastify
 */
export async function registerMcpRoutes(fastify) {
  const allowedOrigin = (() => {
    const fromEnv = process.env.WEB_URL || 'http://localhost:5173'
    try { return new URL(fromEnv).origin } catch { return null }
  })()

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

    const auth = await resolveAuth(request.headers.authorization)
    if (!auth.ok) {
      return reply
        .code(401)
        .header('WWW-Authenticate', 'Bearer realm="peekhook"')
        .send({ jsonrpc: '2.0', id, error: { code: -32001, message: auth.reason } })
    }

    const db          = getDb()
    const readModel   = new MongoRequestListReadModel(db)
    const searchModel = new MongoRequestSearchReadModel(db)
    const surface     = provideTools({ readModel, searchModel })

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
 * this mcp_token. Returns `{ ok: true, inboxToken }` on success or
 * `{ ok: false, reason }` on every failure mode (missing header,
 * malformed header, unknown token). Hashed once on the request path
 * so the plaintext never leaves the inbound boundary.
 */
async function resolveAuth(authorizationHeader) {
  if (typeof authorizationHeader !== 'string' || authorizationHeader.length === 0) {
    return { ok: false, reason: 'missing Authorization: Bearer <token> header' }
  }
  const m = authorizationHeader.match(/^Bearer\s+(.+)$/i)
  if (!m) return { ok: false, reason: 'Authorization must be "Bearer <token>"' }
  const candidate = m[1].trim()
  if (candidate.length === 0) return { ok: false, reason: 'Bearer token is empty' }

  const hashHex = crypto.createHash('sha256').update(candidate).digest('hex')
  const repo    = new MongoMcpAuthRepository(getDb())
  const inbox   = await repo.findByMcpTokenHash(hashHex)
  if (!inbox) return { ok: false, reason: 'invalid token' }
  if (!inbox.token) return { ok: false, reason: 'token resolves to an inbox without an id' }
  return { ok: true, inboxToken: inbox.token }
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
