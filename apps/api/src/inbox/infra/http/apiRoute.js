import { getDb } from '../../../shared/db.js'
import { config } from '../../../config.js'
import { Outcome } from '../../domain/Outcome.js'
import { CreateInbox } from '../../app/CreateInbox.js'
import { ListRequests } from '../../app/ListRequests.js'
import { GetRequest } from '../../app/GetRequest.js'
import { ConfigureResponse } from '../../app/ConfigureResponse.js'
import { ConfigureForward } from '../../app/ConfigureForward.js'
import { ConfigureCaptureFilter } from '../../app/ConfigureCaptureFilter.js'
import { ClearInbox } from '../../app/ClearInbox.js'
import { ExportEvents } from '../../app/ExportEvents.js'
import { GetSchemaHistory } from '../../../schema-history/app/GetSchemaHistory.js'
import { MongoInboxRepository } from '../persistence/MongoInboxRepository.js'
import { MongoCapturedRequestRepository } from '../persistence/MongoCapturedRequestRepository.js'
import { MongoRequestListReadModel } from '../persistence/MongoRequestListReadModel.js'
import { MongoMcpAuthRepository } from '../../../mcp/infra/MongoMcpAuthRepository.js'
import { MintMcpToken } from '../../../mcp/app/MintMcpToken.js'
import { MongoPayloadSchemaRepository } from '../../../schema-history/infra/MongoPayloadSchemaRepository.js'

// A 24-char hex string: the shape of a Mongo ObjectId AND of the SQLite id
// mimic (see SqliteCapturedRequestRepository). Used for id-shape validation
// so this shared route doesn't reach for the `mongodb` driver just to check
// a URL param — it runs unchanged on the SQLite (peekgrok) target too.
const OBJECT_ID_SHAPE = /^[0-9a-f]{24}$/i
function isObjectIdShape(id) {
  return typeof id === 'string' && OBJECT_ID_SHAPE.test(id)
}

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

function nextSseConnectionId() {
  return sseNextConnectionId++
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
  registry:         sseConnectionsByToken,
  register:         registerSseConnection,
  unregister:       unregisterSseConnection,
  nextConnectionId: nextSseConnectionId,
})

/**
 * sseInternals — non-underscored alias of __sseInternals used by
 * the SSE route module (`sseRoute.js`) to mint connection ids and
 * access the registry. Same shape, public name (no `__` prefix)
 * because `sseRoute.js` is part of the same package and the
 * import is intentional rather than test-only.
 */
export const sseInternals = __sseInternals

/**
 * Resolve the persisted-deps to use for this request. In
 * production `buildApp` decorates the fastify instance with the
 * real adapters; in tests the decorator is absent and we fall
 * back to a fresh `getDb()`-sourced Mongo adapter so the
 * existing test suite (which only sets the test db) keeps
 * working without a rewrite.
 *
 * @returns {{
 *   inboxRepo:  InboxRepository,
 *   readModel:  RequestListReadModel,
 *   schemaRepo: PayloadSchemaRepository,
 *   mcpAuth:    McpAuthRepository,
 * }}
 */
function resolveDeps(fastify) {
  // Only consult getDb() when at least one of the storage deps is
  // missing. mcpAuth is separate: it is cloud-only and its absence
  // here just means MCP is disabled (the mintMcpToken caller already
  // gates on the mcpEnabled feature flag).
  const inboxRepo  = fastify.inboxRepo
  const readModel  = fastify.requestReadModel
  const schemaRepo = fastify.schemaRepo
  const storageMissing = !inboxRepo || !readModel || !schemaRepo
  const db = storageMissing ? getDb() : null
  return {
    inboxRepo:  inboxRepo  ?? new MongoInboxRepository(db),
    readModel:  readModel  ?? new MongoRequestListReadModel(db),
    schemaRepo: schemaRepo ?? new MongoPayloadSchemaRepository(db),
    mcpAuth:    fastify.mcpAuth ?? null,  // null when MCP is disabled (local mode)
  }
}

function makeUseCases(fastify) {
  const { inboxRepo, readModel, schemaRepo, mcpAuth } = resolveDeps(fastify)
  return {
    createInbox:       new CreateInbox({ inboxes: inboxRepo }),
    listRequests:      new ListRequests({ requests: readModel }),
    getRequest:        new GetRequest({ requests: readModel }),
    configureResponse: new ConfigureResponse({ inboxes: inboxRepo }),
    configureForward:  new ConfigureForward({ inboxes: inboxRepo, ingestUrl: config.ingestUrl }),
    configureCaptureFilter: new ConfigureCaptureFilter({ inboxes: inboxRepo }),
    mintMcpToken:      new MintMcpToken({ mcpAuth }),
    getSchemaHistory:  new GetSchemaHistory({ schemas: schemaRepo }),
  }
}

export default async function apiRoute(fastify) {
  const features = fastify.features ?? {}
  const mcpEnabled    = features.mcpEnabled    !== false
  const shareEnabled  = features.shareEnabled  !== false

  fastify.post('/api/inboxes', async (request, reply) => {
    const { createInbox, mintMcpToken } = makeUseCases(fastify)
    const result = await createInbox.execute()

    let mcpToken = null
    if (mcpEnabled) {
      const minted = await mintMcpToken.execute({ inboxToken: result.token })
      mcpToken = minted.mcpToken
    }

    return reply.code(201).send({
      token:        result.token,
      url:          `${config.ingestUrl}/i/${result.token}`,
      ingestUrl:    config.ingestUrl,
      expiresAt:    result.expiresAt,
      mcp_token:    mcpToken,
      forwardTo:    null,
      responseConfig: null,
      captureFilter: null,
    })
  })

  fastify.get('/api/inboxes/:token/requests', async (request, reply) => {
    const { token }          = request.params
    const { limit = 50, before } = request.query
    const { listRequests } = makeUseCases(fastify)
    const results = await listRequests.execute({ inboxToken: token, limit, before })
    return reply.send(results)
  })

  // Export every capture in the inbox as a downloadable JSON document.
  // Placed before the `:id` route so `/export` is matched as a literal
  // segment rather than treated as an event id.
  fastify.get('/api/inboxes/:token/export', async (request, reply) => {
    const { token } = request.params
    // Optional `?ids=a,b,c` exports only the selected captures.
    const ids = typeof request.query?.ids === 'string' && request.query.ids.length > 0
      ? request.query.ids.split(',').map((s) => s.trim()).filter(Boolean)
      : null
    const { inboxRepo, readModel } = resolveDeps(fastify)
    const exportEvents = new ExportEvents({ inboxes: inboxRepo, requests: readModel })
    const result = await exportEvents.execute({ token, ids })
    if (!result) return reply.code(404).send({ error: 'Inbox not found' })

    const filename = `peekhook-${token}-export.json`
    return reply
      .header('content-type', 'application/json; charset=utf-8')
      .header('content-disposition', `attachment; filename="${filename}"`)
      .send(result)
  })

  // Delete captures for the inbox. With a non-empty `{ ids }` body, only
  // those captures are removed (the inspector's "delete selected"). With
  // no ids, the whole inbox is cleared AND its lifetime cap reset, so the
  // same webhook URL keeps working. Distinct from DELETE /response (which
  // clears the mock reply) — this clears captured history.
  fastify.delete('/api/inboxes/:token/requests', async (request, reply) => {
    const { token } = request.params
    const body = request.body ?? {}
    const ids = Array.isArray(body.ids) ? body.ids.filter((id) => typeof id === 'string') : []

    const { inboxRepo } = resolveDeps(fastify)
    const capturedRepo = fastify.capturedRequestRepo ?? new MongoCapturedRequestRepository(getDb())

    if (ids.length > 0) {
      const inbox = await inboxRepo.findByToken(token)
      if (!inbox) return reply.code(404).send({ error: 'Inbox not found' })
      const deleted = await capturedRepo.deleteByIds(token, ids)
      return reply.send({ token, deleted })
    }

    const clearInbox = new ClearInbox({ inboxes: inboxRepo, requests: capturedRepo })
    const result = await clearInbox.execute({ token })
    if (result.outcome === Outcome.NOT_FOUND) return reply.code(404).send({ error: 'Inbox not found' })
    return reply.send({ token, deleted: result.deleted })
  })

  fastify.get('/api/inboxes/:token/requests/:id', async (request, reply) => {
    const { token, id } = request.params
    if (!isObjectIdShape(id)) return reply.code(400).send({ error: 'Invalid id' })

    const { getRequest } = makeUseCases(fastify)
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
  if (shareEnabled) {
    fastify.post('/api/inboxes/:token/requests/:id/share', async (request, reply) => {
      const { token, id } = request.params
      if (!isObjectIdShape(id)) return reply.code(400).send({ error: 'Invalid id' })

      const { inboxRepo } = resolveDeps(fastify)
      const inbox = await inboxRepo.findByToken(token)
      if (!inbox) return reply.code(404).send({ error: 'Inbox not found' })

      // Resolve dep-first. The old code always built a Mongo repo from
      // getDb(), so on the SQLite target (peekgrok) share threw
      // "DB not initialized" and ignored the injected SQLite repo.
      const capturedRepo = fastify.capturedRequestRepo ?? new MongoCapturedRequestRepository(getDb())
      const shareId = await capturedRepo.upsertShareId(id, token)
      if (!shareId) return reply.code(404).send({ error: 'Request not found' })

      // Prefer an explicitly configured public base over the request's
      // Host header. The hosted target leaves `shareBase` unset, so it
      // uses the incoming host (e.g. peekhook.0311b.com). The local
      // `peekgrok` target sets it to the public ngrok URL once the tunnel
      // is up, so a shared link is something you can hand to a teammate —
      // not `localhost:4041`. `shareBase` is a mutable holder because the
      // tunnel connects after the server starts listening.
      const configuredBase = fastify.shareBase?.url
      const host = configuredBase
        ? configuredBase.replace(/\/+$/, '')
        : `${request.protocol}://${request.headers.host}`
      const shareUrl = `${host}/c/${shareId}?token=${token}`
      return reply.send({ shareUrl, shareId })
    })
  }

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
      const { readModel } = resolveDeps(fastify)
      const doc = await readModel.findByShareId({ inboxToken: token, shareId: id })
      if (!doc) return reply.code(404).send({ error: 'Request not found' })
      return reply.send(doc)
    }

    // 24-hex ObjectId → look up by _id, scoped to inbox token.
    // Always returns 404 (whether the capture exists, whether it
    // has a shareId). This is the deliberate "old URL is dead"
    // path: leaking an ObjectId is no longer sufficient to read
    // a capture. Users must click share to mint a fresh shareId.
    if (isObjectIdShape(id)) {
      return reply.code(404).send({ error: 'Request not found' })
    }

    // Anything else → 400 (truly malformed input).
    return reply.code(400).send({ error: 'Invalid id' })
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

    // Register the connection BEFORE writing the response headers.
    // Otherwise the 5th-and-then-6th-attempt test (and any real client
    // that opens connections in quick succession) can race: the
    // server sends the 200 to the Nth client, but the `register`
    // happens after an `await` further down, so the (N+1)th
    // `canAcceptSseConnection` check might run before our register
    // commits. Registering first closes the window — the worst case
    // is a leaked registry entry if the handler crashes before
    // hijacking, which the idle timeout cleans up.
    const connectionId = sseNextConnectionId++
    registerSseConnection(token, connectionId)

    const readModel = fastify.requestReadModel ?? new MongoRequestListReadModel(getDb())

    reply.hijack()
    const res = reply.raw
    res.writeHead(200, {
      'Content-Type':      'text/event-stream',
      'Cache-Control':     'no-cache',
      'Connection':        'keep-alive',
      'X-Accel-Buffering': 'no',
    })
    res.write(': connected\n\n')

    let lastId = null
    try {
      const latest = await readModel.findLatest(token)
      lastId = latest ? latest.id : null
    } catch (_) {
      // best-effort: continue with no cursor; the poller will still
      // try to fetch, and the worst case is one extra "everything"
      // emit on first poll, which the client already filters by id.
    }

    let closed = false
    request.raw.on('close', () => { closed = true })

    const idleTimeoutMs = getSseIdleTimeoutMs()
    let lastEventAt = Date.now()
    const idle = setInterval(() => {
      if (closed) { clearInterval(idle); return }
      if (Date.now() - lastEventAt < idleTimeoutMs) return
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
        const newDocs = await readModel.listAfter({
          inboxToken: token,
          afterId:    lastId,
          limit:      20,
        })

        if (newDocs.length > 0) {
          lastEventAt = Date.now()
          for (const dto of newDocs) {
            if (closed) break
            lastId = dto.id
            res.write(`data: ${JSON.stringify({ type: 'request', data: dto })}\n\n`)
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

  fastify.get('/api/inboxes/:token', async (request, reply) => {
    const { token } = request.params
    const { inboxRepo } = resolveDeps(fastify)
    const inbox = await inboxRepo.findByToken(token)
    if (!inbox) return reply.code(404).send({ error: 'Inbox not found' })
    return reply.send({
      token,
      url:           `${config.ingestUrl}/i/${token}`,
      ingestUrl:     config.ingestUrl,
      expiresAt:     inbox.expiresAt,
      responseConfig: inbox.responseConfig ?? null,
      forwardTo:     inbox.forwardTo ?? null,
      captureFilter: inbox.captureFilter ?? null,
    })
  })

  fastify.get('/api/inboxes/:token/schema-history', async (request, reply) => {
    const { token } = request.params
    const { inboxRepo } = resolveDeps(fastify)
    const inbox = await inboxRepo.findByToken(token)
    if (!inbox) return reply.code(404).send({ error: 'Inbox not found' })

    const { getSchemaHistory } = makeUseCases(fastify)
    const result = await getSchemaHistory.execute({ inboxToken: token })
    return reply.send(result)
  })

  fastify.put('/api/inboxes/:token/response', async (request, reply) => {
    const { token } = request.params
    const { configureResponse } = makeUseCases(fastify)
    const result = await configureResponse.execute({ token, responseConfig: request.body ?? null })

    if (result.outcome === Outcome.NOT_FOUND) return reply.code(404).send({ error: 'Inbox not found' })
    if (result.outcome === Outcome.INVALID)  return reply.code(400).send({ error: result.error })
    return reply.send({ token, responseConfig: result.responseConfig })
  })

  fastify.delete('/api/inboxes/:token/response', async (request, reply) => {
    const { token } = request.params
    const { configureResponse } = makeUseCases(fastify)
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
    const { configureForward } = makeUseCases(fastify)
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
    const { configureForward } = makeUseCases(fastify)
    const result = await configureForward.execute({ token, forwardTo: null })

    if (result.outcome === Outcome.NOT_FOUND) return reply.code(404).send({ error: 'Inbox not found' })
    return reply.send({ token, forwardTo: null })
  })

  // Capture filter (allowlist). Gates which requests are logged: a request
  // that matches no rule is answered normally (mock / forward / ack) but is
  // never persisted and consumes neither the lifetime cap nor the rate
  // window. Sibling of /forward — validate at the boundary, persist a
  // normalised value (or null to clear / capture everything).
  fastify.put('/api/inboxes/:token/capture-filter', async (request, reply) => {
    const { token } = request.params
    const body = request.body ?? {}
    const { configureCaptureFilter } = makeUseCases(fastify)
    const result = await configureCaptureFilter.execute({
      token,
      captureFilter: body.captureFilter ?? null,
    })

    if (result.outcome === Outcome.NOT_FOUND) return reply.code(404).send({ error: 'Inbox not found' })
    if (result.outcome === Outcome.INVALID)  return reply.code(400).send({ error: result.error })
    return reply.send({ token, captureFilter: result.captureFilter })
  })

  fastify.delete('/api/inboxes/:token/capture-filter', async (request, reply) => {
    const { token } = request.params
    const { configureCaptureFilter } = makeUseCases(fastify)
    const result = await configureCaptureFilter.execute({ token, captureFilter: null })

    if (result.outcome === Outcome.NOT_FOUND) return reply.code(404).send({ error: 'Inbox not found' })
    return reply.send({ token, captureFilter: null })
  })

  // Mint a fresh MCP token for an existing inbox. The plaintext is
  // returned exactly once; the inbox stores only the new hash.
  // Useful when the inspector was opened by URL and the original
  // plaintext was lost (no localStorage copy available).
  fastify.post('/api/inboxes/:token/regenerate-mcp', async (request, reply) => {
    if (!mcpEnabled) {
      return reply.code(404).send({ error: 'Not found' })
    }
    const { token } = request.params
    const { mintMcpToken } = makeUseCases(fastify)
    try {
      const { mcpToken } = await mintMcpToken.execute({ inboxToken: token })
      return reply.send({ token, mcp_token: mcpToken })
    } catch (err) {
      return reply.code(404).send({ error: 'Inbox not found' })
    }
  })
}
