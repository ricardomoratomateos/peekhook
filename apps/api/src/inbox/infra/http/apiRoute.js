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
import { MongoCapturedRequestRepository } from '../persistence/MongoCapturedRequestRepository.js'
import { MongoRequestListReadModel } from '../persistence/MongoRequestListReadModel.js'
import { MongoMcpAuthRepository } from '../../../mcp/infra/MongoMcpAuthRepository.js'
import { MintMcpToken } from '../../../mcp/app/MintMcpToken.js'
import { MongoPayloadSchemaRepository } from '../../../schema-history/infra/MongoPayloadSchemaRepository.js'

const SSE_MAX_CONNECTIONS_PER_TOKEN = 5
const SSE_DEFAULT_IDLE_TIMEOUT_MS   = 5 * 60 * 1000
const SSE_PING_INTERVAL_MS          = 25_000
const SSE_POLL_INTERVAL_MS          = 1_500

// Per-process registry of active SSE connections, keyed by inbox token.
// Each entry tracks a Set of connection ids so an inbox can hold up to
// SSE_MAX_CONNECTIONS_PER_TOKEN concurrent stream subscribers. Process
// restart resets state (documented limitation, mirrors the replay rate
// limiter pattern).
const sseConnectionsByToken = new Map()
let sseNextConnectionId = 1

// Mutable at runtime via the `__setSseIdleTimeoutForTest` escape hatch
// so the idle-timeout spec can use a 100ms window instead of waiting
// the full 5 minutes. Production code reads this once per request via
// `getSseIdleTimeoutMs()`, so a swap between calls takes effect
// immediately.
let sseIdleTimeoutMs = SSE_DEFAULT_IDLE_TIMEOUT_MS

export function getSseIdleTimeoutMs() { return sseIdleTimeoutMs }

function registerSseConnection(token, connectionId, registry = sseConnectionsByToken) {
  let bucket = registry.get(token)
  if (!bucket) {
    bucket = new Set()
    registry.set(token, bucket)
  }
  bucket.add(connectionId)
  return bucket.size
}

function unregisterSseConnection(token, connectionId, registry = sseConnectionsByToken) {
  const bucket = registry.get(token)
  if (!bucket) return
  bucket.delete(connectionId)
  if (bucket.size === 0) registry.delete(token)
}

/**
 * Pure cap-check predicate. Returns true when a new connection can
 * be accepted, false when the cap is reached. Pure (no side
 * effects on the registry) so tests can exercise it directly
 * without driving the SSE handler.
 */
export function canAcceptSseConnection(token, registry = sseConnectionsByToken) {
  const active = registry.get(token)?.size ?? 0
  return active < SSE_MAX_CONNECTIONS_PER_TOKEN
}

/**
 * Test-only escape hatches. The registry is per-process and survives
 * across calls within the same Node process; a test that mutates the
 * idle timeout must restore it before exiting so the next test sees
 * the production default. `__resetSseForTest` clears the connection
 * registry so a test that closed its connections via timeout does
 * not leak bucket state into siblings.
 */
export function __setSseIdleTimeoutForTest(ms) {
  sseIdleTimeoutMs = ms
}
export function __resetSseForTest() {
  sseConnectionsByToken.clear()
  sseIdleTimeoutMs = SSE_DEFAULT_IDLE_TIMEOUT_MS
}
export const __sseConstants = Object.freeze({
  MAX_CONNECTIONS_PER_TOKEN: SSE_MAX_CONNECTIONS_PER_TOKEN,
  DEFAULT_IDLE_TIMEOUT_MS:   SSE_DEFAULT_IDLE_TIMEOUT_MS,
})
export const __sseInternals = Object.freeze({
  registry:        sseConnectionsByToken,
  register:        registerSseConnection,
  unregister:      unregisterSseConnection,
})

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
    shareId:          doc.shareId ?? null,
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

    // Connection cap (security limits item 8): a single inbox token
    // can hold at most SSE_MAX_CONNECTIONS_PER_TOKEN concurrent stream
    // subscribers. The sixth attempt is rejected with 429 + Retry-After
    // so a misbehaving client cannot pin the API process on a single
    // inbox.
    if (!canAcceptSseConnection(token)) {
      return reply
        .code(429)
        .header('Retry-After', '30')
        .send({
          error: `Max ${SSE_MAX_CONNECTIONS_PER_TOKEN} concurrent SSE connections per inbox`,
          maxConnections: SSE_MAX_CONNECTIONS_PER_TOKEN,
        })
    }

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

    const connectionId = sseNextConnectionId++
    registerSseConnection(token, connectionId)

    let closed = false
    request.raw.on('close', () => { closed = true })

    // Idle timeout (security limits item 9): a connection that has not
    // seen any event for the configured idle window is closed so
    // abandoned tabs (the typical case) do not accumulate server
    // sockets forever.
    //
    // Documented choice — we close with HTTP 200 + empty body rather
    // than 204, because the SSE response has already flushed a
    // `text/event-stream` header with status 200 the moment we wrote
    // `: connected\n\n`. Node refuses a second `writeHead()` after the
    // first body byte, so attempting 204 would either be a no-op
    // (status already 200 on the wire) or throw. The EventSource client
    // treats both shapes as a normal end-of-stream and will reconnect,
    // so the user-visible behavior is identical. We just `res.end()`
    // to close the socket cleanly.
    const idleTimeoutMs = getSseIdleTimeoutMs()
    let lastEventAt = Date.now()
    const idle = setInterval(() => {
      if (closed) { clearInterval(idle); return }
      if (Date.now() - lastEventAt < idleTimeoutMs) return
      // Idle window elapsed — close the stream. Best-effort: the
      // client may have already gone away, in which case the
      // `close` handler below takes over.
      closed = true
      clearInterval(idle)
      clearInterval(poll)
      clearInterval(ping)
      unregisterSseConnection(token, connectionId)
      try {
        res.end()
      } catch (_) { /* socket may already be torn down */ }
    }, Math.min(5_000, Math.max(20, Math.floor(idleTimeoutMs / 4))))

    const poll = setInterval(async () => {
      if (closed) { clearInterval(poll); clearInterval(ping); clearInterval(idle); return }
      try {
        const newDocs = await db.collection('requests')
          .find({ inboxToken: token, _id: { $gt: lastId } })
          .sort({ _id: 1 })
          .limit(20)
          .toArray()

        if (newDocs.length > 0) {
          lastEventAt = Date.now()
          for (const doc of newDocs) {
            if (closed) break
            lastId = doc._id
            res.write(`data: ${JSON.stringify({ type: 'request', data: toDto(doc) })}\n\n`)
          }
        }
      } catch (_) { /* DB error — keep streaming, client will retry */ }
    }, SSE_POLL_INTERVAL_MS)

    const ping = setInterval(() => {
      if (closed) { clearInterval(ping); return }
      lastEventAt = Date.now()
      try { res.write(': ping\n\n') } catch (_) {}
    }, SSE_PING_INTERVAL_MS)

    request.raw.on('close', () => {
      closed = true
      clearInterval(poll)
      clearInterval(ping)
      clearInterval(idle)
      unregisterSseConnection(token, connectionId)
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

  // Mint a share id for a captured request and return the public share
  // URL. The id in the URL is a fresh 16-byte hex token (NOT the Mongo
  // ObjectId) so guessing one capture's id reveals nothing about other
  // captures in any inbox. The token is still required as `?token=` on
  // the resulting URL — without it, a leaked shareId cannot enumerate
  // other inboxes.
  //
  // Idempotent: clicking share twice on the same capture returns the
  // same shareId and the same URL.
  //
  // Response shape (frontend contract):
  //   { shareUrl: "https://<host>/c/<shareId>?token=<inboxToken>" }
  fastify.post('/api/inboxes/:token/requests/:id/share', async (request, reply) => {
    const { token, id } = request.params
    if (!ObjectId.isValid(id)) return reply.code(400).send({ error: 'Invalid id' })

    const db = getDb()
    const inbox = await db.collection('inboxes').findOne(
      { token },
      { projection: { _id: 1 } },
    )
    if (!inbox) return reply.code(404).send({ error: 'Inbox not found' })

    const capturedRepo = new MongoCapturedRequestRepository(db)
    const shareId = await capturedRepo.upsertShareId(id, token)
    if (!shareId) return reply.code(404).send({ error: 'Request not found' })

    const host = `${request.protocol}://${request.headers.host}`
    const shareUrl = `${host}/c/${shareId}?token=${token}`
    return reply.send({ shareUrl, shareId })
  })

  // Public read-only capture by shareId (or legacy ObjectId), scoped
  // to an inbox token.
  //
  // The un-scoped-by-id variant (just `_id`) was removed in the v1.1
  // security pass because the inbox's request id is a Mongo ObjectId —
  // predictable enough that guessing reveals other inboxes' captures.
  // This v1.2 pass goes one step further: the public URL no longer
  // carries the ObjectId. It carries the random shareId minted at
  // share time. The share endpoint (above) is the only path that mints
  // a shareId; old captures captured before this change carry
  // `shareId = null` and are unreadable via the public endpoint by
  // design (share is opt-in).
  //
  // To preserve old bookmarks that pointed at /api/requests/<ObjectId>
  // before this change, the endpoint also accepts the 24-hex ObjectId
  // shape and returns 404 unconditionally for any ObjectId-shaped id
  // (whether or not the capture exists, whether or not it was ever
  // shared) — so leaking the ObjectId of a capture reveals nothing
  // about other captures, but old links do not break with a 5xx.
  fastify.get('/api/requests/:id', async (request, reply) => {
    const { id } = request.params

    const token = typeof request.query?.token === 'string' && request.query.token.length > 0
      ? request.query.token
      : null
    if (!token) {
      return reply.code(400).send({ error: 'token required' })
    }

    // 32-hex shareId → look up by shareId, scoped to inbox token.
    if (typeof id === 'string' && /^[0-9a-f]{32}$/.test(id)) {
      const readModel = new MongoRequestListReadModel(getDb())
      const doc = await readModel.findByShareId({ inboxToken: token, shareId: id })
      if (!doc) return reply.code(404).send({ error: 'Request not found' })
      return reply.send(doc)
    }

    // 24-hex ObjectId → look up by _id, scoped to inbox token.
    // Always returns 404 (whether the capture exists, whether it
    // has a shareId). This is the deliberate "old URL is dead"
    // path: leaking an ObjectId is no longer sufficient to read
    // a capture. Users must click share to mint a fresh shareId.
    if (ObjectId.isValid(id)) {
      return reply.code(404).send({ error: 'Request not found' })
    }

    // Anything else → 400 (truly malformed input).
    return reply.code(400).send({ error: 'Invalid id' })
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
