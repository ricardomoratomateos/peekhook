import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import Fastify from 'fastify'
import { MongoMemoryServer } from 'mongodb-memory-server'
import { MongoClient } from 'mongodb'
import zlib from 'node:zlib'

import { SandboxInbox } from './domain/SandboxInbox.js'
import { MongoInboxRepository } from './infra/persistence/MongoInboxRepository.js'

let memServer
let mongoClient
let db

async function setupMongo() {
  memServer = await MongoMemoryServer.create()
  mongoClient = new MongoClient(memServer.getUri())
  await mongoClient.connect()
  db = mongoClient.db('peekhook-ingest-security-test')
  return db
}

async function teardownMongo() {
  if (mongoClient) await mongoClient.close()
  if (memServer)   await memServer.stop()
}

async function buildIngestFastify(opts = {}) {
  const sharedDbModule = await import('../shared/db.js')
  sharedDbModule.__setDbForTest(db)

  const ingestRouteMod = await import('./infra/http/ingestRoute.js')
  const ingestRoute    = ingestRouteMod.default
  const { config }     = await import('../config.js')

  // Override config.trustProxy for this test. The capture handler
  // reads it at request time, so a one-line flag flip is enough.
  if (opts.trustProxy !== undefined) {
    config.trustProxy = opts.trustProxy
  }

  const fastify = Fastify({
    logger: false,
    ...(opts.trustProxy !== undefined ? { trustProxy: opts.trustProxy } : {}),
    ...opts.fastifyOpts,
  })
  await fastify.register(ingestRoute)
  await fastify.ready()
  return fastify
}

describe('ingestRoute — security limits', () => {
  beforeAll(async () => { await setupMongo() })
  afterAll(async () => { await teardownMongo() })

  it('rejects a body over 1 MB with 413 (item 2: body size cap)', async () => {
    const inboxes = new MongoInboxRepository(db)
    const inbox = SandboxInbox.create()
    await inboxes.insert(inbox)

    const fastify = await buildIngestFastify()
    try {
      const huge = Buffer.alloc(1_048_577, 'a')
      const res = await fastify.inject({
        method:  'POST',
        url:     `/i/${inbox.token}`,
        headers: { 'content-type': 'application/octet-stream' },
        payload: huge,
      })
      expect(res.statusCode).toBe(413)
    } finally {
      await fastify.close()
    }
  })

  it('rejects a gzip-bomb body with 413 (item 4: gzip bomb defense)', async () => {
    const inboxes = new MongoInboxRepository(db)
    const inbox = SandboxInbox.create()
    await inboxes.insert(inbox)

    const fastify = await buildIngestFastify()
    try {
      // 2 MB of zeros → tiny compressed wire size (~1.1 KB with zlib gzip).
      // Wire passes bodyLimit (1 MB) without the inflation cap.
      const twoMb = Buffer.alloc(2_000_000, 0)
      const compressed = zlib.gzipSync(twoMb)
      // Sanity check: wire size is well under 1 MB so it slips past
      // the bodyLimit on its own.
      expect(compressed.length).toBeLessThan(1_048_576)

      const res = await fastify.inject({
        method:  'POST',
        url:     `/i/${inbox.token}`,
        headers: {
          'content-type':     'application/octet-stream',
          'content-encoding': 'gzip',
        },
        payload: compressed,
      })
      expect(res.statusCode).toBe(413)
    } finally {
      await fastify.close()
    }
  })

  it('ignores x-forwarded-for when trustProxy is off (item 6: trust proxy / IP spoofing)', async () => {
    const inboxes = new MongoInboxRepository(db)
    const inbox = SandboxInbox.create()
    await inboxes.insert(inbox)

    const fastify = await buildIngestFastify({ trustProxy: false })
    try {
      const res = await fastify.inject({
        method:  'POST',
        url:     `/i/${inbox.token}`,
        headers: {
          'content-type':     'application/json',
          'x-forwarded-for':  '6.6.6.6',
          'x-real-ip':        '9.9.9.9',
        },
        payload: '{}',
      })
      expect(res.statusCode).toBe(200)

      const persisted = await db.collection('requests').findOne({ inboxToken: inbox.token })
      // Captured IP must NOT be the attacker-controlled header value.
      expect(persisted.ip).not.toBe('6.6.6.6')
      expect(persisted.ip).not.toBe('9.9.9.9')
      // The raw socket IP that fastify.inject synthesizes is 127.0.0.1.
      expect(persisted.ip).toBe('127.0.0.1')
    } finally {
      await fastify.close()
    }
  })

  it('honors x-forwarded-for when trustProxy is on (item 6: trust proxy / IP spoofing)', async () => {
    const inboxes = new MongoInboxRepository(db)
    const inbox = SandboxInbox.create()
    await inboxes.insert(inbox)

    const fastify = await buildIngestFastify({ trustProxy: true })
    try {
      const res = await fastify.inject({
        method:  'POST',
        url:     `/i/${inbox.token}`,
        headers: {
          'content-type':     'application/json',
          'x-forwarded-for':  '203.0.113.5',
        },
        payload: '{}',
      })
      expect(res.statusCode).toBe(200)

      const persisted = await db.collection('requests').findOne({ inboxToken: inbox.token })
      expect(persisted.ip).toBe('203.0.113.5')
    } finally {
      await fastify.close()
    }
  })

  it('returns 429 + Retry-After once 60 captures land within 60s (item 3: rate limit)', async () => {
    const inboxes = new MongoInboxRepository(db)
    const inbox = SandboxInbox.create()
    await inboxes.insert(inbox)

    const fastify = await buildIngestFastify()
    try {
      for (let i = 0; i < 60; i++) {
        const r = await fastify.inject({
          method:  'POST',
          url:     `/i/${inbox.token}`,
          headers: { 'content-type': 'application/json' },
          payload: '{}',
        })
        expect(r.statusCode).toBe(200)
      }

      const blocked = await fastify.inject({
        method:  'POST',
        url:     `/i/${inbox.token}`,
        headers: { 'content-type': 'application/json' },
        payload: '{}',
      })
      expect(blocked.statusCode).toBe(429)
      const retryAfter = blocked.headers['retry-after']
      expect(retryAfter).toBeDefined()
      expect(Number(retryAfter)).toBeGreaterThan(0)
      expect(Number(retryAfter)).toBeLessThanOrEqual(60)
    } finally {
      await fastify.close()
    }
  })

  it('returns 429 once the inbox has reached MAX_CAPTURE_COUNT (item 7: per-inbox cap)', async () => {
    const inboxes = new MongoInboxRepository(db)
    const inbox = SandboxInbox.create({ captureCount: 1000 })
    await inboxes.insert(inbox)

    const fastify = await buildIngestFastify()
    try {
      const res = await fastify.inject({
        method:  'POST',
        url:     `/i/${inbox.token}`,
        headers: { 'content-type': 'application/json' },
        payload: '{}',
      })
      expect(res.statusCode).toBe(429)
    } finally {
      await fastify.close()
    }
  })
})
