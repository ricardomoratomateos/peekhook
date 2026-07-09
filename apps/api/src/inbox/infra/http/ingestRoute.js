import { getDb } from '../../../shared/db.js'
import { config } from '../../../config.js'
import { CaptureRequest } from '../../app/CaptureRequest.js'
import { ForwardRequest } from '../../app/ForwardRequest.js'
import { Outcome } from '../../domain/Outcome.js'
import { MongoInboxRepository } from '../persistence/MongoInboxRepository.js'
import { MongoCapturedRequestRepository } from '../persistence/MongoCapturedRequestRepository.js'
import { runScript } from '../../../scripting/index.js'
import { ScriptOutcome } from '../../../scripting/domain/ScriptErrors.js'
import { MongoPayloadSchemaRepository } from '../../../schema-history/infra/MongoPayloadSchemaRepository.js'
import { RecordSchema } from '../../../schema-history/app/RecordSchema.js'

const BODY_LIMIT_BYTES     = 1_048_576
const CAPTURE_METHODS      = ['POST', 'PUT', 'PATCH', 'DELETE']

/**
 * Wire the CaptureRequest use case from the per-request fastify
 * instance. In production the orchestrator (`buildApp`) decorates
 * the fastify instance with the real adapters; in tests the
 * decorator is absent and we fall back to a fresh `getDb()`-sourced
 * Mongo adapter so the existing test suite (which only sets the
 * test db) keeps working without a rewrite.
 *
 * `fastify` is read off `request.server` (the root fastify instance)
 * by the handler — the handler is module-level so it has no closure
 * over the `fastify` passed to `ingestRoute(fastify)`. The root
 * instance carries the decorations added by `buildApp` and is the
 * same one `__setDbForTest` points at in the test harness.
 */
function makeCaptureRequest(fastify) {
  const inboxRepo  = fastify.inboxRepo
  const schemaRepo = fastify.schemaRepo
  const requestRepo = fastify.capturedRequestRepo
  const storageMissing = !inboxRepo || !schemaRepo || !requestRepo
  const db = storageMissing ? getDb() : null
  return new CaptureRequest({
    inboxes:      inboxRepo  ?? new MongoInboxRepository(db),
    requests:     requestRepo ?? new MongoCapturedRequestRepository(db),
    recordSchema: new RecordSchema({
      schemas: schemaRepo ?? new MongoPayloadSchemaRepository(db),
    }),
    logger:       null,
  })
}

function makeRequestRepo(fastify) {
  return fastify.capturedRequestRepo ?? new MongoCapturedRequestRepository(getDb())
}

function makeForwardRequest(params) {
  return new ForwardRequest({
    ...params,
    ingestOrigin: config.ingestUrl,
  })
}

/**
 * Resolve the client IP from `req.ip`, but ONLY consult forwarded
 * headers (`X-Forwarded-For`, `X-Real-IP`) when the server has been
 * configured to trust them. Without this guard, an attacker posting
 * directly to the API can inject any IP they want via
 * `X-Forwarded-For: 6.6.6.6` and have it show up as their captured IP.
 *
 * Implementation note: Fastify's `trustProxy` option is not exposed
 * as a public property on the instance, so we read the shared
 * `config.trustProxy` flag (set in `apps/api/src/config.js`) instead.
 *
 * When `trustProxy` is on, we honor `req.ip` (which Fastify resolves
 * via the `proxy-addr` chain against `X-Forwarded-For`); otherwise
 * we return the raw socket peer.
 */
function resolveClientIp(request) {
  // Read the live config flag (set in `apps/api/src/config.js` from
  // `TRUST_PROXY` and `NODE_ENV`). Reading at request time lets tests
  // override `config.trustProxy` for individual cases without needing
  // a request decorator or plugin encapsulation workaround.
  if (config.trustProxy) return request.ip
  return request.socket && request.socket.remoteAddress ? request.socket.remoteAddress : request.ip
}

async function captureHandler(request, reply) {
  const { token } = request.params

  const rawBody    = request.rawBody ?? ''
  const size       = request.rawBodySize ?? 0

  const path        = request.url.split('?')[0]
  const query       = request.query
  const contentType = request.headers['content-type'] ?? ''
  const clientIp    = resolveClientIp(request)

  const result = await makeCaptureRequest(request.server).execute({
    inboxToken:  token,
    method:      request.method,
    path,
    query,
    headers:     request.headers,
    body:        rawBody,
    contentType,
    size,
    ip:          clientIp,
  })

  if (result.outcome === Outcome.INBOX_NOT_FOUND) {
    return reply.code(404).send({ error: 'Inbox not found' })
  }

  if (result.outcome === Outcome.CAPACITY_EXCEEDED) {
    return reply
      .code(429)
      .header('Retry-After', '60')
      .send({ error: 'Inbox has reached its 1,000-capture lifetime cap. Mint a new inbox to continue.' })
  }

  if (result.outcome === Outcome.RATE_LIMITED) {
    const retryAfter = String(result.retryAfterSec ?? 60)
    return reply
      .code(429)
      .header('Retry-After', retryAfter)
      .send({ error: 'Rate limit exceeded (60 req / min / token). Try again later.', retryAfterSec: Number(retryAfter) })
  }

  const captureId = result.id.toString()
  const capturedRepo = makeRequestRepo(request.server)

  // Precedence: an explicitly-enabled mock reply wins over forwarding.
  // Enabling a mock is a deliberate "intercept and simulate" action — and in
  // local `peekgrok` sniffer mode forwarding is on by default, so if the mock
  // did not short-circuit here it could never fire. (Historically forwardTo
  // won; the flip makes the explicit toggle authoritative.)
  const cfg = result.responseConfig
  if (cfg && cfg.enabled) {
    let body = cfg.body
    if (cfg.scriptEnabled && typeof cfg.script === 'string' && cfg.script.length > 0) {
      const scriptResult = await runScript.execute({
        script: cfg.script,
        request: {
          method:      request.method,
          path,
          headers:     request.headers,
          body:        rawBody,
          contentType,
          query,
        },
      })

      if (scriptResult.outcome === ScriptOutcome.OK) {
        body = scriptResult.body
      } else if (scriptResult.outcome === ScriptOutcome.THREW) {
        return reply.code(500).send({ error: 'script threw' })
      }
    }
    return reply
      .code(cfg.status)
      .header('content-type', cfg.contentType)
      .send(body)
  }

  if (result.forwardTo) {
    const fwd = await makeForwardRequest({
      targetUrl: result.forwardTo,
      method:    request.method,
      headers:   request.headers,
      body:      rawBody,
    }).execute()

    let upstreamDto
    let replyStatus
    let replyHeaders
    let replyBody

    if (fwd.ok) {
      upstreamDto = {
        status:      fwd.status,
        headers:     fwd.headers,
        body:        fwd.body,
        contentType: fwd.contentType,
        durationMs:  fwd.durationMs,
      }
      replyStatus  = fwd.status
      replyHeaders = fwd.headers
      replyBody    = fwd.body
    } else if (fwd.error === 'loop') {
      upstreamDto = {
        error:      'loop',
        message:    fwd.message,
        durationMs: fwd.durationMs,
      }
      replyStatus = 502
      replyBody   = { error: 'forward loop detected', message: fwd.message }
    } else if (fwd.error === 'timeout') {
      upstreamDto = {
        error:      'timeout',
        message:    fwd.message,
        durationMs: fwd.durationMs,
      }
      replyStatus = 504
      replyBody   = { error: 'forward timeout', message: fwd.message }
    } else {
      upstreamDto = {
        error:      fwd.error,
        message:    fwd.message,
        durationMs: fwd.durationMs,
      }
      replyStatus = 502
      replyBody   = { error: 'forward failed', message: fwd.message }
    }

    try {
      await capturedRepo.updateUpstreamResponse(captureId, upstreamDto)
    } catch (_err) {
      /* capture update failure must not change the response to the caller */
    }

    const reply2 = reply.code(replyStatus)
    if (replyHeaders && typeof replyHeaders === 'object') {
      for (const [k, v] of Object.entries(replyHeaders)) {
        if (k.toLowerCase() === 'content-type') continue
        reply2.header(k, v)
      }
    }
    if (replyHeaders && replyHeaders['content-type']) {
      reply2.header('content-type', replyHeaders['content-type'])
    } else if (fwd.ok) {
      reply2.header('content-type', fwd.contentType || 'application/octet-stream')
    }
    return reply2.send(replyBody)
  }

  return reply.code(200).send({ ok: true, id: captureId })
}

/**
 * Hard body-size cap that Fastify applies BEFORE any of our content-type
 * parsers see the buffer. The cap is the wire size — gzip bombs are
 * caught separately by the `preParsing` hook below.
 */
function captureBody(req, body, done) {
  req.rawBody     = body.toString('utf8')
  req.rawBodySize = body.length
  done(null, null)
}

export default async function ingestRoute(fastify) {
  fastify.addContentTypeParser(
    ['application/json', 'text/plain'],
    { parseAs: 'buffer' },
    captureBody,
  )
  fastify.addContentTypeParser('*', { parseAs: 'buffer' }, captureBody)

  for (const method of CAPTURE_METHODS) {
    fastify.route({
      method,
      url:     '/i/:token',
      handler: captureHandler,
      bodyLimit: BODY_LIMIT_BYTES,
    })
  }

  /**
   * Gzip bomb defense. Fastify's `bodyLimit` is checked on the
   * RAW (compressed) bytes — that's intentional, because the wire
   * size is the only number the server sees before decoding. But
   * that means a 1 KB gzip stream of "AAAA..." can decompress to
   * 10 MB and still pass the cap. We enforce the same cap on the
   * DECOMPRESSED size via a `preParsing` hook: when a compressed
   * body hits the parser chain, we wrap the payload in a
   * zlib-inflate transform stream. Fastify then streams the
   * inflated bytes through the content-type parser, and its
   * internal `receivedLength > limit` check (contentTypeParser.js
   * `rawBody()`) rejects with FST_ERR_CTP_BODY_TOO_LARGE → 413
   * once the decoded size crosses 1 MB.
   *
   * We additionally set `payload.receivedEncodedLength` to the
   * wire Content-Length so the bodyLimit guard catches bombs
   * that lie about their encoded size.
   */
  fastify.addHook('preParsing', async (request, reply, payload) => {
    const encoding = request.headers['content-encoding']
    if (!encoding) return payload
    if (!/^\s*(gzip|deflate|br|x-gzip)\s*$/i.test(encoding)) return payload

    const zlib = await import('node:zlib')
    let stream
    const enc = encoding.trim().toLowerCase()
    if (enc === 'gzip' || enc === 'x-gzip') {
      stream = zlib.createGunzip()
    } else if (enc === 'deflate') {
      stream = zlib.createInflate()
    } else if (enc === 'br') {
      stream = zlib.createBrotliDecompress()
    } else {
      return payload
    }
    const contentLength = Number(request.headers['content-length'])
    if (Number.isFinite(contentLength) && contentLength > 0) {
      payload.receivedEncodedLength = contentLength
    }
    return payload.pipe(stream)
  })

  // GET /i/:token → 405 guard. On the hosted API the inspector SPA is a
  // separate origin, so a GET here is always a misdirected curl and 405 is
  // right. In local `peekgrok` mode the SPA is served on the SAME origin,
  // and its inspector route IS `/i/:token` — there we must NOT register
  // this route so the GET falls through to the SPA fallback. The local
  // entry sets `features.ingestGetGuard = false`; everywhere else the flag
  // is absent and the guard stays on (default).
  if (fastify.features?.ingestGetGuard !== false) {
    fastify.get('/i/:token', async (request, reply) => {
      return reply.code(405).send({
        error: 'Inbox ingest accepts POST/PUT/PATCH/DELETE only. GET is reserved for the inspector UI.',
      })
    })
  }
}
