import Fastify from 'fastify'
import { CaptureRequest } from '@peekhook/api/src/inbox/app/CaptureRequest.js'
import { ForwardRequest } from '@peekhook/api/src/inbox/infra/ForwardRequest.js'
import { runScript } from '@peekhook/api/src/scripting/index.js'
import { ScriptOutcome } from '@peekhook/api/src/scripting/domain/ScriptErrors.js'

const BODY_LIMIT_BYTES = 1_048_576

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * startProxyServer — the ngrok-style transparent sniffer surface of
 * `peekgrok`.
 *
 * Unlike the hosted `/i/:token` ingest (a terminal endpoint scoped by a
 * token in the path), this listener is a catch-all reverse proxy: EVERY
 * path and EVERY method is captured into a single session inbox and then
 * forwarded to `upstream`, preserving the original path + query. The
 * upstream's response is recorded on the capture and returned verbatim to
 * the caller — so the developer's real app keeps working while every
 * request/response pair shows up live in the inspector.
 *
 * This is the port ngrok tunnels. The inspector UI, `/api`, and `/mcp`
 * live on a SEPARATE local listener (the `startLocalServer` app) — exactly
 * like ngrok's own inspector on :4040 sits beside the forwarded traffic.
 *
 * Reuse: capture goes through the same `CaptureRequest` use case (so the
 * SSE poller, storage, search, and MCP all see these events with zero
 * extra wiring — they share the SQLite db) and forwarding goes through the
 * same `ForwardRequest` adapter as the hosted forward feature. The only
 * behavioural differences are (a) the token is resolved from the session,
 * not the URL, (b) the forward target is `upstream + path`, not a fixed
 * inbox URL, and (c) capacity/rate limits are bypassed — a full-app proxy
 * would blow the 1,000-cap in seconds, and the user owns the machine.
 *
 * Precedence: an explicitly-enabled `responseConfig` (mock reply) on the
 * session inbox short-circuits the forward, so "simulate a failure" still
 * works from the inspector UI even though forwarding is always on.
 *
 * Limitation: the upstream response body is read as UTF-8 text (inherited
 * from ForwardRequest, which targets webhook/JSON/HTML traffic). Binary
 * assets (images, fonts) proxied through here will be mangled. Point the
 * tunnel at API/XHR/webhook traffic, not a full asset-serving browse.
 *
 * @param {{
 *   port:                number,
 *   host?:               string,
 *   upstream:            string,   // base URL, e.g. "http://localhost:8080"
 *   sessionToken:        string,   // inbox token captures are written to
 *   inboxRepo:           import('@peekhook/api/src/inbox/domain/InboxRepository.js').InboxRepository,
 *   capturedRequestRepo: import('@peekhook/api/src/inbox/domain/CapturedRequestRepository.js').CapturedRequestRepository,
 *   ingestOrigin?:       string,   // for the ForwardRequest loop guard
 *   forwardTimeoutMs?:   number,
 *   ignorePaths?:        string[], // path prefixes to forward WITHOUT capturing
 *   logger?:             boolean | object,
 * }} opts
 * @returns {Promise<import('fastify').FastifyInstance>}
 */
export async function startProxyServer({
  port,
  host = '127.0.0.1',
  upstream,
  sessionToken,
  inboxRepo,
  capturedRequestRepo,
  ingestOrigin,
  forwardTimeoutMs = 30_000,
  ignorePaths = [],
  inspectorBase,
  logger = false,
}) {
  if (!upstream) throw new Error('startProxyServer: `upstream` is required')
  if (!sessionToken) throw new Error('startProxyServer: `sessionToken` is required')

  const upstreamBase = String(upstream).replace(/\/+$/, '')

  // When an inspector base is provided, a small set of inspector-owned
  // paths are served by peekhook's local inspector instead of being
  // forwarded to your app — so a public ngrok share link (which tunnels
  // THIS proxy port) can actually render the read-only capture view. The
  // set is deliberately narrow; if your app happens to use one of these
  // prefixes it would be shadowed, which is why they're logged at boot.
  const inspectorTarget = inspectorBase ? String(inspectorBase).replace(/\/+$/, '') : null
  const RESERVED_FOR_INSPECTOR = [/^\/c(\/|$)/, /^\/assets\//, /^\/api\/requests(\/|$)/]
  const isInspectorPath = (p) => Boolean(inspectorTarget) && RESERVED_FOR_INSPECTOR.some((re) => re.test(p))

  // Noise filter: requests whose path starts with any of these prefixes
  // are still forwarded (your app keeps working) but NOT captured, so the
  // inspector feed isn't drowned in health checks, asset requests, etc.
  const ignoreList = (ignorePaths || [])
    .map((p) => String(p).trim())
    .filter(Boolean)
  const shouldIgnore = (path) => ignoreList.some((prefix) => path.startsWith(prefix))

  const capture = new CaptureRequest({
    inboxes:       inboxRepo,
    requests:      capturedRequestRepo,
    // No schema-history folding on the hot proxy path — it's a webhook
    // analytics feature, not worth the per-request cost here.
    recordSchema:  null,
    // Local sniffer: never reject on the 60/min or 1,000-cap. A real app
    // behind the tunnel generates far more traffic than a webhook inbox.
    enforceLimits: false,
  })

  const app = Fastify({ logger, bodyLimit: BODY_LIMIT_BYTES, forceCloseConnections: true })

  // Capture the raw body byte-for-byte for every content type so we can
  // both record it and replay it upstream unchanged.
  const captureBody = (req, body, done) => {
    // Keep the exact bytes for a byte-faithful forward, and a UTF-8 view
    // for the capture record (lossy for binary uploads, but the record
    // is for display; the forward below uses the raw buffer).
    req.rawBodyBuffer = body
    req.rawBody       = body.toString('utf8')
    req.rawBodySize   = body.length
    done(null, null)
  }
  // Override Fastify's built-in application/json parser (which would consume
  // the body into `req.body` and leave `rawBody` empty) and register the
  // wildcard for everything else, so we hold the raw bytes for every type.
  app.addContentTypeParser(['application/json', 'text/plain'], { parseAs: 'buffer' }, captureBody)
  app.addContentTypeParser('*', { parseAs: 'buffer' }, captureBody)

  const methods = ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']
  // Register the catch-all on both `/` and `/*` so the site root and every
  // nested path funnel through the same handler.
  app.route({ method: methods, url: '/',  handler: proxyHandler })
  app.route({ method: methods, url: '/*', handler: proxyHandler })

  async function proxyHandler(request, reply) {
    const rawBody     = request.rawBody ?? ''
    const size        = request.rawBodySize ?? 0
    const path        = request.url.split('?')[0]
    const query       = request.query ?? {}
    const contentType = request.headers['content-type'] ?? ''
    const ip          = (request.socket && request.socket.remoteAddress) || request.ip

    // Inspector-owned paths (share view + its assets + the public share
    // API) are relayed to the local inspector, NOT the upstream app, and
    // are never captured. This is what lets a public ngrok share link
    // resolve in sniffer mode (the tunnel points at this proxy port).
    if (isInspectorPath(path)) {
      const insp = await new ForwardRequest({
        targetUrl:    inspectorTarget + request.url,
        method:       request.method,
        headers:      request.headers,
        body:         request.rawBodyBuffer ?? rawBody,
        ingestOrigin,
        timeoutMs:    forwardTimeoutMs,
      }).execute()
      return respondFromForward(reply, insp)
    }

    // Peek at the session inbox to decide mock-vs-forward BEFORE capturing.
    // We capture LAST (with the response inline) so the row is inserted
    // complete and the SSE poller streams request + response together.
    const inbox = await inboxRepo.findByToken(sessionToken)
    if (!inbox) {
      return reply.code(502).send({ error: 'peekgrok session inbox missing — restart peekgrok' })
    }

    const captureBase = {
      inboxToken: sessionToken,
      method:     request.method,
      path,
      query,
      headers:    request.headers,
      body:       rawBody,
      contentType,
      size,
      ip,
    }
    // Ignored paths (health checks, assets, …) are proxied but not
    // recorded: swap `record` for a no-op so the mock/forward flow is
    // unchanged and only the capture is skipped.
    const ignored = shouldIgnore(path)
    const record = ignored
      ? async () => {}
      : (upstreamResponse) =>
          capture.execute({ ...captureBase, upstreamResponse }).catch(() => {
            /* capture must never change what the caller sees */
          })

    // Mock reply wins over forwarding when explicitly enabled (see header).
    const cfg = inbox.responseConfig
    if (cfg && cfg.enabled) {
      let body = cfg.body
      if (cfg.scriptEnabled && typeof cfg.script === 'string' && cfg.script.length > 0) {
        const scriptResult = await runScript.execute({
          script: cfg.script,
          request: { method: request.method, path, headers: request.headers, body: rawBody, contentType, query },
        })
        if (scriptResult.outcome === ScriptOutcome.OK) {
          body = scriptResult.body
        } else if (scriptResult.outcome === ScriptOutcome.THREW) {
          await record({ error: 'script_threw', message: 'mock reply script threw', durationMs: 0, mocked: true })
          return reply.code(500).send({ error: 'script threw' })
        }
      }
      // Record the simulated reply as the "response" so the inspector shows
      // what peekgrok returned instead of the (skipped) upstream.
      await record({
        status:      cfg.status,
        headers:     { 'content-type': cfg.contentType },
        body,
        contentType: cfg.contentType,
        durationMs:  cfg.delayMs > 0 ? cfg.delayMs : 0,
        mocked:      true,
      })
      if (Number.isInteger(cfg.delayMs) && cfg.delayMs > 0) {
        await sleep(cfg.delayMs)
      }
      return reply.code(cfg.status).header('content-type', cfg.contentType).send(body)
    }

    // Forward to the upstream app, preserving the original path + query.
    // Send the raw request bytes (not the UTF-8 view) so binary uploads
    // reach the upstream intact.
    const fwd = await new ForwardRequest({
      targetUrl:    upstreamBase + request.url,
      method:       request.method,
      headers:      request.headers,
      body:         request.rawBodyBuffer ?? rawBody,
      ingestOrigin,
      timeoutMs:    forwardTimeoutMs,
    }).execute()

    const upstreamDto = fwd.ok
      ? { status: fwd.status, headers: fwd.headers, body: fwd.body, contentType: fwd.contentType, durationMs: fwd.durationMs }
      : { error: fwd.error, message: fwd.message, durationMs: fwd.durationMs }

    await record(upstreamDto)

    return respondFromForward(reply, fwd)
  }

  await app.listen({ port, host })
  return app
}

/**
 * Relay a `ForwardRequest` result to the client verbatim. Shared by the
 * upstream-forward path and the inspector-path relay. Binary bodies are
 * sent as raw bytes; `content-encoding` / `content-length` are dropped
 * because `fetch` already decoded the body and set a new length.
 */
function respondFromForward(reply, fwd) {
  let status
  let headers
  let body

  if (fwd.ok) {
    status  = fwd.status
    headers = fwd.headers
    body    = fwd.isBinary && fwd.bodyBuffer ? fwd.bodyBuffer : fwd.body
  } else if (fwd.error === 'timeout') {
    status = 504
    body   = { error: 'upstream timeout', message: fwd.message }
  } else {
    status = 502
    body   = { error: 'upstream unreachable', message: fwd.message }
  }

  const out = reply.code(status)
  if (headers && typeof headers === 'object') {
    for (const [k, v] of Object.entries(headers)) {
      const lk = k.toLowerCase()
      if (lk === 'content-type' || lk === 'content-encoding' || lk === 'content-length') continue
      out.header(k, v)
    }
    if (headers['content-type']) {
      out.header('content-type', headers['content-type'])
    } else if (fwd.ok) {
      out.header('content-type', fwd.contentType || 'application/octet-stream')
    }
  } else if (fwd.ok) {
    out.header('content-type', fwd.contentType || 'application/octet-stream')
  }
  return out.send(body)
}
