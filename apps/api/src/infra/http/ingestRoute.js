import { ObjectId } from 'mongodb'
import { getDb } from '../../../shared/config/db.js'
import { CaptureRequest } from '../../app/CaptureRequest.js'
import { Outcome } from '../../domain/Outcome.js'
import { MongoInboxRepository } from '../persistence/MongoInboxRepository.js'
import { MongoCapturedRequestRepository } from '../persistence/MongoCapturedRequestRepository.js'

/** Composition root: wire CaptureRequest to its Mongo adapters. */
function makeCaptureRequest() {
  const db = getDb()
  return new CaptureRequest({
    inboxes:  new MongoInboxRepository(db),
    requests: new MongoCapturedRequestRepository(db),
  })
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

  fastify.all('/i/:token', async (request, reply) => {
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

    const cfg = result.responseConfig
    if (cfg && cfg.enabled) {
      return reply
        .code(cfg.status)
        .header('content-type', cfg.contentType)
        .send(cfg.body)
    }

    return reply.code(200).send({ ok: true, id: result.id.toString() })
  })
}
