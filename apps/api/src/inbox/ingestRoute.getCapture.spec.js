import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import Fastify from 'fastify'
import { MongoMemoryServer } from 'mongodb-memory-server'
import { MongoClient } from 'mongodb'

import { SandboxInbox } from './domain/SandboxInbox.js'
import { MongoInboxRepository } from './infra/persistence/MongoInboxRepository.js'
import { MongoRequestListReadModel } from './infra/persistence/MongoRequestListReadModel.js'

let memServer
let mongoClient
let db

async function setupMongo() {
  memServer = await MongoMemoryServer.create()
  mongoClient = new MongoClient(memServer.getUri())
  await mongoClient.connect()
  db = mongoClient.db('peekhook-ingest-get-test')
  return db
}

async function teardownMongo() {
  if (mongoClient) await mongoClient.close()
  if (memServer)   await memServer.stop()
}

async function startIngest({ features } = {}) {
  const sharedDbModule = await import('../shared/db.js')
  sharedDbModule.__setDbForTest(db)
  const ingestRouteMod = await import('./infra/http/ingestRoute.js')
  const fastify = Fastify({ logger: false })
  if (features) fastify.decorate('features', features)
  await fastify.register(ingestRouteMod.default)
  await fastify.ready()
  return fastify
}

async function seedInbox() {
  const inbox = SandboxInbox.create()
  await new MongoInboxRepository(db).insert(inbox)
  return inbox
}

describe('GET /i/:token capture (hosted target)', () => {
  beforeAll(async () => { await setupMongo() })
  afterAll(async () => { await teardownMongo() })

  it('rejects a browser navigation (Accept: text/html) with 405', async () => {
    const inbox = await seedInbox()
    const fastify = await startIngest()
    try {
      const res = await fastify.inject({
        method: 'GET',
        url: `/i/${inbox.token}`,
        headers: { accept: 'text/html,application/xhtml+xml' },
      })
      expect(res.statusCode).toBe(405)
    } finally {
      await fastify.close()
    }
  })

  it('captures a non-browser GET (e.g. OAuth callback / verification ping)', async () => {
    const inbox = await seedInbox()
    const fastify = await startIngest()
    try {
      const res = await fastify.inject({
        method: 'GET',
        url: `/i/${inbox.token}?code=abc123`,
        headers: { accept: 'application/json' },
      })
      expect(res.statusCode).toBe(200)
      const body = JSON.parse(res.body)
      expect(body.ok).toBe(true)
      expect(typeof body.id).toBe('string')

      const captures = await new MongoRequestListReadModel(db).list({ inboxToken: inbox.token })
      expect(captures).toHaveLength(1)
      expect(captures[0].method).toBe('GET')
      expect(captures[0].query).toEqual({ code: 'abc123' })
    } finally {
      await fastify.close()
    }
  })

  it('does NOT register a capturing GET route in local SPA mode (ingestGetGuard=false)', async () => {
    const inbox = await seedInbox()
    const fastify = await startIngest({ features: { ingestGetGuard: false } })
    try {
      // No GET route is registered, so it falls through to Fastify's
      // default 404 (in production the SPA fallback serves index.html).
      const res = await fastify.inject({ method: 'GET', url: `/i/${inbox.token}` })
      expect(res.statusCode).toBe(404)
    } finally {
      await fastify.close()
    }
  })
})
