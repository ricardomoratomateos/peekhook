import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest'
import Fastify from 'fastify'
import { MongoMemoryServer } from 'mongodb-memory-server'
import { MongoClient } from 'mongodb'
import http from 'node:http'

import apiRoute, {
  canAcceptSseConnection,
  __setSseIdleTimeoutForTest,
  __resetSseForTest,
  __sseConstants,
  __sseInternals,
  getSseIdleTimeoutMs,
} from './infra/http/apiRoute.js'
import { SandboxInbox } from './domain/SandboxInbox.js'
import { MongoInboxRepository } from './infra/persistence/MongoInboxRepository.js'

let memServer
let mongoClient
let db
let fastify
let baseUrl

async function setupMongo() {
  memServer = await MongoMemoryServer.create()
  mongoClient = new MongoClient(memServer.getUri())
  await mongoClient.connect()
  db = mongoClient.db('peekhook-sse-security-test')
  return db
}

async function teardownMongo() {
  if (mongoClient) await mongoClient.close()
  if (memServer)   await memServer.stop()
}

async function startFastify() {
  const sharedDbModule = await import('../shared/db.js')
  sharedDbModule.__setDbForTest(db)
  fastify = Fastify({ logger: false })
  await fastify.register(apiRoute)
  await fastify.ready()
  await fastify.listen({ port: 0, host: '127.0.0.1' })
  const addr = fastify.server.address()
  baseUrl = `http://127.0.0.1:${addr.port}`
  return fastify
}

async function stopFastify() {
  if (fastify) {
    await fastify.close()
    fastify = undefined
    baseUrl = undefined
  }
}

/**
 * Open a raw HTTP GET against the SSE endpoint. Returns the
 * IncomingMessage and a `done` promise that resolves with the
 * final statusCode once the server closes the response. Caller
 * is responsible for destroying the request if it leaks.
 */
function openSse(token) {
  return new Promise((resolve, reject) => {
    const req = http.request(`${baseUrl}/api/inboxes/${token}/stream`, { method: 'GET' }, (res) => {
      const final = new Promise((resFinal) => {
        res.on('end', () => resFinal(res.statusCode))
        res.on('close', () => resFinal(res.statusCode))
      })
      // Drain a few bytes to make sure the server actually sent
      // the headers before we hand control back.
      res.on('data', () => {})
      resolve({ req, res, statusCode: res.statusCode, done: final })
    })
    req.on('error', reject)
    req.end()
  })
}

describe('apiRoute — SSE connection cap (item 8) + idle timeout (item 9)', () => {
  beforeAll(async () => { await setupMongo() })
  afterAll(async () => {
    await stopFastify()
    await teardownMongo()
  })
  afterEach(() => {
    __resetSseForTest()
  })

  it('rejects the 6th concurrent SSE connection on the same token with 429 + Retry-After', async () => {
    const inboxRepo = new MongoInboxRepository(db)
    const inbox = SandboxInbox.create(); await inboxRepo.insert(inbox)

    await startFastify()

    // Open 5 real SSE connections (the max). We don't await `done`
    // because the server intends to keep them open indefinitely.
    const handles = []
    for (let i = 0; i < __sseConstants.MAX_CONNECTIONS_PER_TOKEN; i++) {
      const h = await openSse(inbox.token)
      expect(h.statusCode).toBe(200)
      handles.push(h)
    }

    // The 6th attempt must be rejected.
    const blocked = await new Promise((resolve, reject) => {
      const req = http.request(`${baseUrl}/api/inboxes/${inbox.token}/stream`, { method: 'GET' }, (res) => {
        let body = ''
        res.on('data', (chunk) => { body += chunk.toString('utf8') })
        res.on('end', () => resolve({ statusCode: res.statusCode, headers: res.headers, body }))
      })
      req.on('error', reject)
      req.end()
    })
    expect(blocked.statusCode).toBe(429)
    expect(blocked.headers['retry-after']).toBeDefined()
    const parsed = JSON.parse(blocked.body)
    expect(parsed.error).toMatch(/concurrent SSE/i)
    expect(parsed.maxConnections).toBe(__sseConstants.MAX_CONNECTIONS_PER_TOKEN)

    // Cleanup: destroy the open SSE handles so the test exits cleanly.
    for (const h of handles) h.req.destroy()
    await stopFastify()
  })

  it('closes an idle SSE connection after the idle timeout', async () => {
    const inboxRepo = new MongoInboxRepository(db)
    const inbox = SandboxInbox.create(); await inboxRepo.insert(inbox)

    // Shrink the idle window so the test runs in a few hundred ms.
    // The production default is 5 minutes (security limits item 9).
    __setSseIdleTimeoutForTest(100)

    await startFastify()
    try {
      const handle = await openSse(inbox.token)
      expect(handle.statusCode).toBe(200)

      // The server should close the stream once the idle window
      // elapses without any new events. We assert on the response
      // 'end' event (i.e. server-initiated close), not on the
      // status code: see apiRoute.js for the documented choice to
      // send 200 + empty body rather than 204, since the SSE
      // response has already flushed the 200 header by the time
      // the idle check fires.
      const closed = await Promise.race([
        handle.done.then(() => true),
        new Promise((_, reject) => setTimeout(() => reject(new Error('idle close did not fire in time')), 2_000)),
      ])
      expect(closed).toBe(true)
    } finally {
      await stopFastify()
      __setSseIdleTimeoutForTest(__sseConstants.DEFAULT_IDLE_TIMEOUT_MS)
    }
  })

  it('canAcceptSseConnection gates on the registry (item 8 contract)', () => {
    const registry = new Map()
    expect(canAcceptSseConnection('tok', registry)).toBe(true)

    for (let i = 0; i < __sseConstants.MAX_CONNECTIONS_PER_TOKEN; i++) {
      __sseInternals.register('tok', 1 + i, registry)
    }
    expect(canAcceptSseConnection('tok', registry)).toBe(false)

    __sseInternals.unregister('tok', 1, registry)
    expect(canAcceptSseConnection('tok', registry)).toBe(true)

    // Cleanup
    for (let i = 1; i < __sseConstants.MAX_CONNECTIONS_PER_TOKEN; i++) {
      __sseInternals.unregister('tok', 1 + i, registry)
    }
  })

  it('idle timeout window is configurable at runtime (test-only override)', () => {
    __setSseIdleTimeoutForTest(50)
    expect(getSseIdleTimeoutMs()).toBe(50)
    __setSseIdleTimeoutForTest(__sseConstants.DEFAULT_IDLE_TIMEOUT_MS)
    expect(getSseIdleTimeoutMs()).toBe(__sseConstants.DEFAULT_IDLE_TIMEOUT_MS)
  })
})