import Fastify from 'fastify'
import { CaptureRequest } from '@peekhook/api/src/inbox/app/CaptureRequest.js'
import { ForwardRequest } from '@peekhook/api/src/inbox/app/ForwardRequest.js'
import { runScript } from '@peekhook/api/src/scripting/index.js'
import { ScriptOutcome } from '@peekhook/api/src/scripting/domain/ScriptErrors.js'

const BODY_LIMIT_BYTES = 1_048_576

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
  logger = false,
}) {
  if (!upstream) throw new Error('startProxyServer: `upstream` is required')
  if (!sessionToken) throw new Error('startProxyServer: `sessionToken` is required')

  const upstreamBase = String(upstream).replace(/\/+$/, '')

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

  const app = Fastify({ logger, bodyLimit: BODY_LIMIT_BYTES })

  // Capture the raw body byte-for-byte for every content type so we can
  // both record it and replay it upstream unchanged.
  const captureBody = (req, body, done) => {
    req.rawBody     = body.toString('utf8')
    req.rawBodySize = body.length
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
    const record = (upstreamResponse) =>
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
        durationMs:  0,
        mocked:      true,
      })
      return reply.code(cfg.status).header('content-type', cfg.contentType).send(body)
    }

    // Forward to the upstream app, preserving the original path + query.
    const fwd = await new ForwardRequest({
      targetUrl:    upstreamBase + request.url,
      method:       request.method,
      headers:      request.headers,
      body:         rawBody,
      ingestOrigin,
      timeoutMs:    forwardTimeoutMs,
    }).execute()

    let upstreamDto
    let replyStatus
    let replyHeaders
    let replyBody

    if (fwd.ok) {
      upstreamDto  = { status: fwd.status, headers: fwd.headers, body: fwd.body, contentType: fwd.contentType, durationMs: fwd.durationMs }
      replyStatus  = fwd.status
      replyHeaders = fwd.headers
      replyBody    = fwd.body
    } else if (fwd.error === 'timeout') {
      upstreamDto = { error: 'timeout', message: fwd.message, durationMs: fwd.durationMs }
      replyStatus = 504
      replyBody   = { error: 'upstream timeout', message: fwd.message }
    } else {
      upstreamDto = { error: fwd.error, message: fwd.message, durationMs: fwd.durationMs }
      replyStatus = 502
      replyBody   = { error: 'upstream unreachable', message: fwd.message }
    }

    await record(upstreamDto)

    const out = reply.code(replyStatus)
    if (replyHeaders && typeof replyHeaders === 'object') {
      for (const [k, v] of Object.entries(replyHeaders)) {
        const lk = k.toLowerCase()
        if (lk === 'content-type') continue
        // `fetch` already decompressed the upstream body, so the upstream's
        // content-encoding no longer describes what we send, and its
        // content-length no longer matches. Relaying either makes the
        // browser try to gunzip plain text → ERR_CONTENT_DECODING_FAILED.
        // Drop both; Fastify sets the correct length for the body we send.
        if (lk === 'content-encoding' || lk === 'content-length') continue
        out.header(k, v)
      }
      if (replyHeaders['content-type']) {
        out.header('content-type', replyHeaders['content-type'])
      } else if (fwd.ok) {
        out.header('content-type', fwd.contentType || 'application/octet-stream')
      }
    } else if (fwd.ok) {
      out.header('content-type', fwd.contentType || 'application/octet-stream')
    }
    return out.send(replyBody)
  }

  await app.listen({ port, host })
  return app
}
