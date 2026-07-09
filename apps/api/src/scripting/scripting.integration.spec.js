import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import Fastify from 'fastify'
import { MongoMemoryServer } from 'mongodb-memory-server'
import { MongoClient } from 'mongodb'
import { SandboxInbox } from '../inbox/domain/SandboxInbox.js'
import { MongoInboxRepository } from '../inbox/infra/persistence/MongoInboxRepository.js'
import ingestRoute from '../inbox/infra/http/ingestRoute.js'

const mockDb = vi.hoisted(() => ({ db: null }))

vi.mock('../shared/db.js', () => ({
  connectDb: async () => {},
  getDb:     () => mockDb.db,
  closeDb:   async () => {},
}))

let memServer
let mongoClient
let server
let inbox

async function repo() {
  return new MongoInboxRepository(mockDb.db)
}

describe('scripting integration', () => {
  beforeAll(async () => {
    memServer = await MongoMemoryServer.create()
    mongoClient = new MongoClient(memServer.getUri())
    await mongoClient.connect()
    mockDb.db = mongoClient.db('peekhook-test')

    inbox = SandboxInbox.create()
    await (await repo()).insert(inbox)

    server = Fastify({ logger: false })
    await server.register(ingestRoute)
    await server.ready()
  })

  afterAll(async () => {
    if (server)     await server.close()
    if (mongoClient) await mongoClient.close()
    if (memServer)  await memServer.stop()
  })

  it('runs an echo script and uses its return value as the response body', async () => {
    await (await repo()).updateResponseConfig(inbox.token, {
      enabled:       true,
      status:        200,
      contentType:   'application/json',
      body:          '{"fallback":true}',
      scriptEnabled: true,
      script:        'return JSON.stringify({ echo: request.body, method: request.method, type: "echo" })',
    })

    const response = await server.inject({
      method:  'POST',
      url:     `/i/${inbox.token}`,
      headers: { 'content-type': 'application/json' },
      payload:  JSON.stringify({ x: 1 }),
    })

    expect(response.statusCode).toBe(200)
    expect(response.headers['content-type']).toMatch(/application\/json/)
    const parsed = JSON.parse(response.body)
    expect(parsed.type).toBe('echo')
    expect(parsed.method).toBe('POST')
    expect(parsed.echo).toBe(JSON.stringify({ x: 1 }))
  })

  it('cannot reach `process` from inside the sandbox and the server stays up', async () => {
    await (await repo()).updateResponseConfig(inbox.token, {
      enabled:       true,
      status:        200,
      contentType:   'application/json',
      body:          '{"fallback":true}',
      scriptEnabled: true,
      script:        'process.exit(1); return "should not reach"',
    })

    const response = await server.inject({
      method:  'POST',
      url:     `/i/${inbox.token}`,
      headers: { 'content-type': 'application/json' },
      payload:  '{"y":2}',
    })

    expect(response.statusCode).toBe(500)
    expect(response.body).toBe(JSON.stringify({ error: 'script threw' }))

    // A browser GET (Accept: text/html) is still rejected with 405 —
    // used here as a cheap "server is still alive" probe after the
    // script crash. (Non-browser GETs are now captured; see ingestRoute.)
    const after = await server.inject({
      method: 'GET',
      url:    '/i/' + inbox.token,
      headers: { accept: 'text/html' },
    })
    expect(after.statusCode).toBe(405)
  })

  it('replaces a >200ms script with the static-fallback body', async () => {
    await (await repo()).updateResponseConfig(inbox.token, {
      enabled:       true,
      status:        201,
      contentType:   'text/plain',
      body:          'static fallback',
      scriptEnabled: true,
      script:        'while (Date.now() < Date.now() + 500) {} return "should never make it"',
    })

    const t0 = Date.now()
    const response = await server.inject({
      method:  'POST',
      url:     `/i/${inbox.token}`,
      headers: { 'content-type': 'text/plain' },
      payload:  'hello',
    })
    const elapsed = Date.now() - t0

    expect(response.statusCode).toBe(201)
    expect(response.body).toBe('static fallback')
    expect(elapsed).toBeLessThan(1500)
  })

  it('returns the static body when scriptEnabled is false even if script is set', async () => {
    await (await repo()).updateResponseConfig(inbox.token, {
      enabled:       true,
      status:        200,
      contentType:   'application/json',
      body:          '{"static":true}',
      scriptEnabled: false,
      script:        'return "unused"',
    })

    const response = await server.inject({
      method:  'POST',
      url:     `/i/${inbox.token}`,
      headers: { 'content-type': 'application/json' },
      payload:  '{}',
    })

    expect(response.statusCode).toBe(200)
    expect(response.body).toBe('{"static":true}')
  })
})
