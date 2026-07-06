import { ObjectId } from 'mongodb'
import { getDb } from '../../../shared/db.js'
import { config } from '../../../config.js'
import { Outcome } from '../../domain/Outcome.js'
import { CreateInbox } from '../../app/CreateInbox.js'
import { ListRequests } from '../../app/ListRequests.js'
import { GetRequest } from '../../app/GetRequest.js'
import { ConfigureResponse } from '../../app/ConfigureResponse.js'
import { ConfigureForward } from '../../app/ConfigureForward.js'
import { GetSchemaHistory } from '../../../schema-history/app/GetSchemaHistory.js'
import { MongoInboxRepository } from '../persistence/MongoInboxRepository.js'
import { MongoRequestListReadModel } from '../persistence/MongoRequestListReadModel.js'
import { MongoMcpAuthRepository } from '../../../mcp/infra/MongoMcpAuthRepository.js'
import { MintMcpToken } from '../../../mcp/app/MintMcpToken.js'
import { MongoPayloadSchemaRepository } from '../../../schema-history/infra/MongoPayloadSchemaRepository.js'

function makeUseCases() {
  const db = getDb()
  const readModel  = new MongoRequestListReadModel(db)
  const inboxRepo  = new MongoInboxRepository(db)
  const schemaRepo = new MongoPayloadSchemaRepository(db)
  const mcpAuth    = new MongoMcpAuthRepository(db)
  return {
    createInbox:       new CreateInbox({ inboxes: inboxRepo }),
    listRequests:      new ListRequests({ requests: readModel }),
    getRequest:        new GetRequest({ requests: readModel }),
    configureResponse: new ConfigureResponse({ inboxes: inboxRepo }),
    configureForward:  new ConfigureForward({ inboxes: inboxRepo, ingestUrl: config.ingestUrl }),
    mintMcpToken:      new MintMcpToken({ mcpAuth }),
    getSchemaHistory:  new GetSchemaHistory({ schemas: schemaRepo }),
  }
}

function toDto(doc) {
  return {
    id:               doc._id.toString(),
    method:           doc.method,
    path:             doc.path,
    query:            doc.query,
    headers:          doc.headers,
    body:             doc.body,
    contentType:      doc.contentType,
    size:             doc.size,
    ip:               doc.ip,
    createdAt:        doc.createdAt,
    upstreamResponse: doc.upstreamResponse ?? null,
  }
}

export default async function apiRoute(fastify) {
  fastify.post('/api/inboxes', async (request, reply) => {
    const { createInbox, mintMcpToken } = makeUseCases()
    const result = await createInbox.execute()
    const { mcpToken } = await mintMcpToken.execute({ inboxToken: result.token })
    return reply.code(201).send({
      token:        result.token,
      url:          `${config.ingestUrl}/i/${result.token}`,
      ingestUrl:    config.ingestUrl,
      expiresAt:    result.expiresAt,
      mcp_token:    mcpToken,
      forwardTo:    null,
      responseConfig: null,
    })
  })

  fastify.get('/api/inboxes/:token/stream', async (request, reply) => {
    const { token } = request.params

    reply.hijack()
    const res = reply.raw
    res.writeHead(200, {
      'Content-Type':      'text/event-stream',
      'Cache-Control':     'no-cache',
      'Connection':        'keep-alive',
      'X-Accel-Buffering': 'no',
    })
    res.write(': connected\n\n')

    const db = getDb()

    const latestDoc = await db.collection('requests').findOne(
      { inboxToken: token },
      { sort: { _id: -1 }, projection: { _id: 1 } },
    )
    let lastId = latestDoc?._id ?? new ObjectId(Math.floor(Date.now() / 1000))

    let closed = false
    request.raw.on('close', () => { closed = true })

    const poll = setInterval(async () => {
      if (closed) { clearInterval(poll); clearInterval(ping); return }
      try {
        const newDocs = await db.collection('requests')
          .find({ inboxToken: token, _id: { $gt: lastId } })
          .sort({ _id: 1 })
          .limit(20)
          .toArray()

        for (const doc of newDocs) {
          if (closed) break
          lastId = doc._id
          res.write(`data: ${JSON.stringify({ type: 'request', data: toDto(doc) })}\n\n`)
        }
      } catch (_) { /* DB error — keep streaming, client will retry */ }
    }, 1500)

    const ping = setInterval(() => {
      if (closed) { clearInterval(ping); return }
      try { res.write(': ping\n\n') } catch (_) {}
    }, 25000)

    request.raw.on('close', () => {
      clearInterval(poll)
      clearInterval(ping)
      if (!res.destroyed) res.end()
    })
  })

  fastify.get('/api/inboxes/:token/requests', async (request, reply) => {
    const { token }          = request.params
    const { limit = 50, before } = request.query
    const { listRequests } = makeUseCases()
    const results = await listRequests.execute({ inboxToken: token, limit, before })
    return reply.send(results)
  })

  fastify.get('/api/inboxes/:token/requests/:id', async (request, reply) => {
    const { token, id } = request.params
    if (!ObjectId.isValid(id)) return reply.code(400).send({ error: 'Invalid id' })

    const { getRequest } = makeUseCases()
    const result = await getRequest.execute({ inboxToken: token, id })
    if (!result) return reply.code(404).send({ error: 'Request not found' })
    return reply.send(result)
  })

  // Public read-only capture by id. Returns a sanitized DTO that
  // drops the inboxToken so a shared link doesn't leak the inbox
  // it's associated with. Inbox token is still resolved at fetch
  // time so the public view can render the inspector's chrome.
  fastify.get('/api/requests/:id', async (request, reply) => {
    const { id } = request.params
    if (!ObjectId.isValid(id)) return reply.code(400).send({ error: 'Invalid id' })

    const db = getDb()
    const doc = await db.collection('requests').findOne({ _id: new ObjectId(id) })
    if (!doc) return reply.code(404).send({ error: 'Request not found' })
    return reply.send(toDto(doc))
  })

  fastify.get('/api/inboxes/:token', async (request, reply) => {
    const { token } = request.params
    const db = getDb()
    const inbox = await db.collection('inboxes').findOne(
      { token },
      { projection: { _id: 0 } },
    )
    if (!inbox) return reply.code(404).send({ error: 'Inbox not found' })
    return reply.send({
      token,
      url:           `${config.ingestUrl}/i/${token}`,
      ingestUrl:     config.ingestUrl,
      expiresAt:     inbox.expiresAt,
      responseConfig: inbox.responseConfig ?? null,
      forwardTo:     inbox.forwardTo ?? null,
    })
  })

  fastify.get('/api/inboxes/:token/schema-history', async (request, reply) => {
    const { token } = request.params
    const db = getDb()
    const inbox = await db.collection('inboxes').findOne(
      { token },
      { projection: { _id: 0 } },
    )
    if (!inbox) return reply.code(404).send({ error: 'Inbox not found' })

    const { getSchemaHistory } = makeUseCases()
    const result = await getSchemaHistory.execute({ inboxToken: token })
    return reply.send(result)
  })

  fastify.put('/api/inboxes/:token/response', async (request, reply) => {
    const { token } = request.params
    const { configureResponse } = makeUseCases()
    const result = await configureResponse.execute({ token, responseConfig: request.body ?? null })

    if (result.outcome === Outcome.NOT_FOUND) return reply.code(404).send({ error: 'Inbox not found' })
    if (result.outcome === Outcome.INVALID)  return reply.code(400).send({ error: result.error })
    return reply.send({ token, responseConfig: result.responseConfig })
  })

  fastify.delete('/api/inboxes/:token/response', async (request, reply) => {
    const { token } = request.params
    const { configureResponse } = makeUseCases()
    const result = await configureResponse.execute({ token, responseConfig: null })

    if (result.outcome === Outcome.NOT_FOUND) return reply.code(404).send({ error: 'Inbox not found' })
    return reply.send({ token, responseConfig: null })
  })

  // Forwarding target. Sibling of /response: same shape, different field.
  // Precedence with responseConfig is "forwardTo wins" — but both can be
  // set in storage independently. The UI surfaces a modal warning when one
  // overwrites the other; the server treats them as independent inputs.
  fastify.put('/api/inboxes/:token/forward', async (request, reply) => {
    const { token } = request.params
    const body = request.body ?? {}
    const { configureForward } = makeUseCases()
    const result = await configureForward.execute({
      token,
      forwardTo: body.forwardTo ?? null,
    })

    if (result.outcome === Outcome.NOT_FOUND) return reply.code(404).send({ error: 'Inbox not found' })
    if (result.outcome === Outcome.INVALID)  return reply.code(400).send({ error: result.error })
    return reply.send({ token, forwardTo: result.forwardTo })
  })

  fastify.delete('/api/inboxes/:token/forward', async (request, reply) => {
    const { token } = request.params
    const { configureForward } = makeUseCases()
    const result = await configureForward.execute({ token, forwardTo: null })

    if (result.outcome === Outcome.NOT_FOUND) return reply.code(404).send({ error: 'Inbox not found' })
    return reply.send({ token, forwardTo: null })
  })

  // Mint a fresh MCP token for an existing inbox. The plaintext is
  // returned exactly once; the inbox stores only the new hash.
  // Useful when the inspector was opened by URL and the original
  // plaintext was lost (no localStorage copy available).
  fastify.post('/api/inboxes/:token/regenerate-mcp', async (request, reply) => {
    const { token } = request.params
    const { mintMcpToken } = makeUseCases()
    try {
      const { mcpToken } = await mintMcpToken.execute({ inboxToken: token })
      return reply.send({ token, mcp_token: mcpToken })
    } catch (err) {
      return reply.code(404).send({ error: 'Inbox not found' })
    }
  })
}
