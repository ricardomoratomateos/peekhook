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

function makeCaptureRequest() {
  const db = getDb()
  const schemas = new MongoPayloadSchemaRepository(db)
  return new CaptureRequest({
    inboxes:      new MongoInboxRepository(db),
    requests:     new MongoCapturedRequestRepository(db),
    recordSchema: new RecordSchema({ schemas }),
  })
}

function makeForwardRequest(params) {
  return new ForwardRequest({
    ...params,
    ingestOrigin: config.ingestUrl,
  })
}

const CAPTURE_METHODS = ['POST', 'PUT', 'PATCH', 'DELETE']

async function captureHandler(request, reply) {
  const { token } = request.params

  const rawBody    = request.rawBody ?? ''
  const size       = request.rawBodySize ?? 0

  const path        = request.url.split('?')[0]
  const query       = request.query
  const contentType = request.headers['content-type'] ?? ''
  const clientIp    = request.headers['x-forwarded-for']?.split(',')[0].trim()
    || request.headers['x-real-ip']
    || request.ip

  const result = await makeCaptureRequest().execute({
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

  const captureId = result.id.toString()
  const db = getDb()
  const capturedRepo = new MongoCapturedRequestRepository(db)

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

  return reply.code(200).send({ ok: true, id: captureId })
}

export default async function ingestRoute(fastify) {
  const captureBody = (req, body, done) => {
    req.rawBody     = body.toString('utf8')
    req.rawBodySize = body.length
    done(null, null)
  }

  fastify.addContentTypeParser(
    ['application/json', 'text/plain'],
    { parseAs: 'buffer' },
    captureBody,
  )
  fastify.addContentTypeParser('*', { parseAs: 'buffer' }, captureBody)

  for (const method of CAPTURE_METHODS) {
    fastify.route({ method, url: '/i/:token', handler: captureHandler })
  }

  fastify.get('/i/:token', async (request, reply) => {
    return reply.code(405).send({
      error: 'Inbox ingest accepts POST/PUT/PATCH/DELETE only. GET is reserved for the inspector UI.',
    })
  })
}
