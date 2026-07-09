import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import Fastify from 'fastify'
import { MongoMemoryServer } from 'mongodb-memory-server'
import { MongoClient } from 'mongodb'

import { SandboxInbox } from './domain/SandboxInbox.js'
import { MongoInboxRepository } from './infra/persistence/MongoInboxRepository.js'

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

async function startIngest({ spaIndexHtml } = {}) {
  const sharedDbModule = await import('../shared/db.js')
  sharedDbModule.__setDbForTest(db)
  const ingestRouteMod = await import('./infra/http/ingestRoute.js')
  const fastify = Fastify({ logger: false })
  if (spaIndexHtml) fastify.decorate('spaIndexHtml', spaIndexHtml)
  await fastify.register(ingestRouteMod.default)
  await fastify.ready()
  return fastify
}

async function seedInbox() {
  const inbox = SandboxInbox.create()
  await new MongoInboxRepository(db).insert(inbox)
  return inbox
}

const SPA_HTML = '<!doctype html><html><body>spa</body></html>'

describe('GET /i/* — hosted target (no SPA decorated)', () => {
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

  it('rejects a non-browser GET (Accept: application/json) with 405', async () => {
    // The WIP design dropped "capture non-browser GET" (OAuth callbacks,
    // Slack/Twilio verification pings). All GETs are 405 in hosted mode —
    // callers that need to receive GETs should use the mcp_token-bound
    // ingest flow. See apps/api/src/inbox/infra/http/ingestRoute.js.
    const inbox = await seedInbox()
    const fastify = await startIngest()
    try {
      const res = await fastify.inject({
        method: 'GET',
        url: `/i/${inbox.token}?code=abc123`,
        headers: { accept: 'application/json' },
      })
      expect(res.statusCode).toBe(405)
    } finally {
      await fastify.close()
    }
  })
})

describe('GET /i/* — CLI target (spaIndexHtml decorated)', () => {
  beforeAll(async () => { await setupMongo() })
  afterAll(async () => { await teardownMongo() })

  it('serves the inspector SPA at /i/<token>', async () => {
    const inbox = await seedInbox()
    const fastify = await startIngest({ spaIndexHtml: Buffer.from(SPA_HTML) })
    try {
      const res = await fastify.inject({
        method: 'GET',
        url: `/i/${inbox.token}`,
        headers: { accept: 'text/html' },
      })
      expect(res.statusCode).toBe(200)
      expect(res.headers['content-type']).toMatch(/text\/html/)
      expect(res.body).toBe(SPA_HTML)
    } finally {
      await fastify.close()
    }
  })

  it('serves the inspector SPA at /i/<token>/<subpath> too (regression: reload on /schema, /mcp, /reply)', async () => {
    const inbox = await seedInbox()
    const fastify = await startIngest({ spaIndexHtml: Buffer.from(SPA_HTML) })
    try {
      for (const subpath of ['schema', 'mcp', 'reply', 'forward', 'docs', 'foo/bar/baz']) {
        const res = await fastify.inject({
          method: 'GET',
          url: `/i/${inbox.token}/${subpath}`,
        })
        expect(res.statusCode, `subpath ${subpath}`).toBe(200)
        expect(res.body, `subpath ${subpath}`).toBe(SPA_HTML)
      }
    } finally {
      await fastify.close()
    }
  })

  it('does not intercept POST/PUT/PATCH/DELETE on /i/<token> (capture methods still work)', async () => {
    const inbox = await seedInbox()
    const fastify = await startIngest({ spaIndexHtml: Buffer.from(SPA_HTML) })
    try {
      for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
        const res = await fastify.inject({
          method,
          url: `/i/${inbox.token}`,
          payload: '{"hello":"world"}',
          headers: { 'content-type': 'application/json' },
        })
        // The narrower `/i/:token` capture route is registered first and
        // wins for the exact path. The wildcard `/i/*` only catches
        // /i/<token>/<subpath> GETs.
        expect(res.statusCode, method).toBe(200)
      }
    } finally {
      await fastify.close()
    }
  })
})
