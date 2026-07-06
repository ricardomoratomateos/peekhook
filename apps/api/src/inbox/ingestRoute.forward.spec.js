import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import Fastify from 'fastify'
import { MongoMemoryServer } from 'mongodb-memory-server'
import { MongoClient, ObjectId } from 'mongodb'

import { SandboxInbox } from './domain/SandboxInbox.js'
import { MongoInboxRepository } from './infra/persistence/MongoInboxRepository.js'
import { MongoCapturedRequestRepository } from './infra/persistence/MongoCapturedRequestRepository.js'
import { MongoRequestListReadModel } from './infra/persistence/MongoRequestListReadModel.js'

let memServer
let mongoClient
let db
let fetchCalls
let originalFetch

async function setupMongo() {
  memServer = await MongoMemoryServer.create()
  mongoClient = new MongoClient(memServer.getUri())
  await mongoClient.connect()
  db = mongoClient.db('peekhook-ingest-forward-test')
  return db
}

async function teardownMongo() {
  if (mongoClient) await mongoClient.connect()
  if (mongoClient) await mongoClient.close()
  if (memServer)   await memServer.stop()
}

/**
 * Build a Fastify with just the ingest route registered, plus a Test
 * stub of fetch. The route uses getDb() to access repos, so we patch
 * shared/db to return our test db.
 */
async function buildIngestOnlyServer() {
  const fastify = Fastify({ logger: false })

  fastify.decorate('getDb', () => db)

  // Replace the shared getDb module by setting a module override via
  // a fresh require cache entry. Simpler: just import after module
  // is mocked via vitest mocks.
  return fastify
}

async function startFastifyWithIngest() {
  // Use a dynamic import after registering the db shim so the shared module
  // resolves to our in-memory db.
  const sharedDbModule = await import('../shared/db.js')
  sharedDbModule.__setDbForTest(db)

  const ingestRouteMod = await import('./infra/http/ingestRoute.js')
  const ingestRoute    = ingestRouteMod.default

  const fastify = Fastify({ logger: false })
  await fastify.register(ingestRoute)
  await fastify.ready()
  return fastify
}

describe('ingestRoute with forwardTo (integration)', () => {
  beforeAll(async () => { await setupMongo() })
  afterAll(async () => { await teardownMongo() })

  beforeEach(() => {
    fetchCalls = []
    originalFetch = globalThis.fetch
    globalThis.fetch = async (url, init) => {
      fetchCalls.push({ url: String(url), init })
      const urlStr = String(url)
      if (urlStr.includes('localhost:3001')) {
        return new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
      }
      return new Response('upstream says hi', {
        status: 418,
        headers: { 'content-type': 'text/plain', 'x-from-upstream': 'yes' },
      })
    }
  })

  function restore() {
    globalThis.fetch = originalFetch
  }

  it('captures, forwards to forwardTo, returns upstream response, persists upstreamResponse', async () => {
    const inboxes  = new MongoInboxRepository(db)
    const inbox    = SandboxInbox.create()
    await inboxes.insert(inbox)
    await inboxes.updateForwardTo(inbox.token, 'http://localhost:3001/hook')

    const fastify = await startFastifyWithIngest()
    try {
      const res = await fastify.inject({
        method:  'POST',
        url:     `/i/${inbox.token}`,
        headers: {
          'content-type':     'application/json',
          'x-webhook-token':  'whsec_test',
        },
        payload:  JSON.stringify({ event: 'created' }),
      })

      expect(res.statusCode).toBe(200)
      expect(res.body).toBe(JSON.stringify({ ok: true }))
      expect(fetchCalls).toHaveLength(1)
      expect(fetchCalls[0].url).toBe('http://localhost:3001/hook')
      expect(fetchCalls[0].init.method).toBe('POST')
      expect(fetchCalls[0].init.body).toBe(JSON.stringify({ event: 'created' }))

      // Capture doc should now contain upstreamResponse with status 200
      const captureId = (() => {
        const list = db.collection('requests').find({ inboxToken: inbox.token }).toArray()
        return null // placeholder; replaced below by awaiting
      })()
      const docs = await db.collection('requests').find({ inboxToken: inbox.token }).toArray()
      expect(docs).toHaveLength(1)
      expect(docs[0].upstreamResponse).toBeDefined()
      expect(docs[0].upstreamResponse.status).toBe(200)
      expect(docs[0].upstreamResponse.body).toBe(JSON.stringify({ ok: true }))
      expect(docs[0].upstreamResponse.contentType).toBe('application/json')
      expect(typeof docs[0].upstreamResponse.durationMs).toBe('number')
    } finally {
      await fastify.close()
      restore()
    }
  })

  it('returns 502 with loop error when forwardTo points into /i/ of the ingest origin', async () => {
    const inboxes  = new MongoInboxRepository(db)
    const inbox    = SandboxInbox.create()
    await inboxes.insert(inbox)
    await inboxes.updateForwardTo(inbox.token, `http://localhost:3000/i/${inbox.token}`)

    const fastify = await startFastifyWithIngest()
    try {
      const res = await fastify.inject({
        method:  'POST',
        url:     `/i/${inbox.token}`,
        headers: { 'content-type': 'application/json' },
        payload:  '{}',
      })

      expect(res.statusCode).toBe(502)
      const body = JSON.parse(res.body)
      expect(body.error).toBe('forward loop detected')
      expect(fetchCalls).toHaveLength(0)

      const docs = await db.collection('requests').find({ inboxToken: inbox.token }).toArray()
      expect(docs[0].upstreamResponse.error).toBe('loop')
    } finally {
      await fastify.close()
      restore()
    }
  })

  it('falls back to the default 200 ok acknowledgement when forwardTo is null', async () => {
    const inboxes  = new MongoInboxRepository(db)
    const inbox    = SandboxInbox.create()
    await inboxes.insert(inbox)
    // no forwardTo

    const fastify = await startFastifyWithIngest()
    try {
      const res = await fastify.inject({
        method:  'POST',
        url:     `/i/${inbox.token}`,
        headers: { 'content-type': 'application/json' },
        payload:  '{}',
      })

      expect(res.statusCode).toBe(200)
      const body = JSON.parse(res.body)
      expect(body.ok).toBe(true)
      expect(body.id).toBeDefined()
      expect(fetchCalls).toHaveLength(0)
    } finally {
      await fastify.close()
      restore()
    }
  })

  it('returns 502 when the upstream returns fetch_failed (e.g. connection refused)', async () => {
    globalThis.fetch = async () => {
      const err = new Error('ECONNREFUSED')
      throw err
    }

    const inboxes  = new MongoInboxRepository(db)
    const inbox    = SandboxInbox.create()
    await inboxes.insert(inbox)
    await inboxes.updateForwardTo(inbox.token, 'http://127.0.0.1:1/hook')

    const fastify = await startFastifyWithIngest()
    try {
      const res = await fastify.inject({
        method:  'POST',
        url:     `/i/${inbox.token}`,
        headers: { 'content-type': 'application/json' },
        payload:  '{}',
      })

      expect(res.statusCode).toBe(502)
      const body = JSON.parse(res.body)
      expect(body.error).toBe('forward failed')
      expect(body.message).toBe('ECONNREFUSED')

      const docs = await db.collection('requests').find({ inboxToken: inbox.token }).toArray()
      expect(docs[0].upstreamResponse.error).toBe('fetch_failed')
      expect(docs[0].upstreamResponse.message).toBe('ECONNREFUSED')
    } finally {
      await fastify.close()
      restore()
    }
  })
})
