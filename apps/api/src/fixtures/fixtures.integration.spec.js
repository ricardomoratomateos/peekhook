import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import Fastify from 'fastify'
import { MongoMemoryServer } from 'mongodb-memory-server'
import { MongoClient } from 'mongodb'
import { SandboxInbox } from '../inbox/domain/SandboxInbox.js'
import { MongoInboxRepository } from '../inbox/infra/persistence/MongoInboxRepository.js'
import { ListRequests } from '../inbox/app/ListRequests.js'
import { MongoRequestListReadModel } from '../inbox/infra/persistence/MongoRequestListReadModel.js'
import apiRoute from '../inbox/infra/http/apiRoute.js'
import registerFixtureRoutes from './infra/fixtures.http.js'

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

describe('fixtures (full stack: Fastify + Mongo + CaptureRequest pipeline)', () => {
  beforeAll(async () => {
    memServer = await MongoMemoryServer.create()
    mongoClient = new MongoClient(memServer.getUri())
    await mongoClient.connect()
    mockDb.db = mongoClient.db('peekhook-test')

    inbox = SandboxInbox.create()
    await new MongoInboxRepository(mockDb.db).insert(inbox)

    server = Fastify({ logger: false })
    // Wire both apiRoute (existing inbox read endpoints used by the test)
    // and registerFixtureRoutes (the new routes under test). Their paths
    // are non-overlapping so order doesn't matter.
    await server.register(apiRoute)
    await server.register(registerFixtureRoutes)
    await server.ready()
  })

  afterAll(async () => {
    if (server)      await server.close()
    if (mongoClient) await mongoClient.close()
    if (memServer)   await memServer.stop()
  })

  it('GET /api/fixtures lists the four seeded fixtures without exposing body content', async () => {
    const res = await server.inject({ method: 'GET', url: '/api/fixtures' })
    expect(res.statusCode).toBe(200)
    const rows = JSON.parse(res.body)

    expect(rows.map((r) => r.id)).toEqual([
      'stripe.payment_intent.succeeded',
      'github.push',
      'linear.issue.updated',
      'generic.webhook_test',
    ])

    for (const row of rows) {
      expect(row).not.toHaveProperty('body')
      expect(row).not.toHaveProperty('headers')
      expect(typeof row.body_size).toBe('number')
      expect(row.body_size).toBeGreaterThan(0)
      expect(typeof row.name).toBe('string')
      expect(typeof row.provider).toBe('string')
      expect(typeof row.label).toBe('string')
    }
  })

  it('POST stripe fixture is captured into the inbox with the right headers and body', async () => {
    const send = await server.inject({
      method: 'POST',
      url: `/api/inboxes/${inbox.token}/fixtures/stripe.payment_intent.succeeded`,
    })
    expect(send.statusCode).toBe(200)
    const { ok, eventId } = JSON.parse(send.body)
    expect(ok).toBe(true)
    expect(typeof eventId).toBe('string')
    expect(eventId.length).toBeGreaterThan(0)

    const list = await new ListRequests({
      requests: new MongoRequestListReadModel(mockDb.db),
    }).execute({ inboxToken: inbox.token, limit: 50 })

    const captured = list.find((r) => r.headers['content-type'] === 'application/json'
      && r.body.includes('payment_intent.succeeded'))
    expect(captured).toBeDefined()
    expect(captured.method).toBe('POST')
    expect(captured.path).toBe(`/i/${inbox.token}`)
    expect(captured.contentType).toBe('application/json')
    expect(captured.headers['content-type']).toBe('application/json')

    const parsed = JSON.parse(captured.body)
    expect(parsed.type).toBe('payment_intent.succeeded')
    expect(parsed.data.object.id).toBe('pi_demo_3MtwQvL8Kb9XmZ')
    expect(parsed.data.object.amount).toBe(4200)
    expect(parsed.data.object.currency).toBe('usd')
  })

  it('POST github fixture preserves the X-GitHub-Event header and commits payload', async () => {
    const send = await server.inject({
      method: 'POST',
      url: `/api/inboxes/${inbox.token}/fixtures/github.push`,
    })
    expect(send.statusCode).toBe(200)

    const list = await new ListRequests({
      requests: new MongoRequestListReadModel(mockDb.db),
    }).execute({ inboxToken: inbox.token, limit: 50 })

    const captured = list.find((r) => r.headers['x-github-event'] === 'push')
    expect(captured).toBeDefined()
    const parsed = JSON.parse(captured.body)
    expect(parsed.ref).toBe('refs/heads/main')
    expect(parsed.repository.full_name).toBe('acme/webhookguard-demo')
    expect(parsed.pusher.name).toBe('ricardo')
    expect(Array.isArray(parsed.commits)).toBe(true)
    expect(parsed.commits).toHaveLength(2)
    expect(parsed.commits[0]).toHaveProperty('id')
    expect(parsed.commits[0]).toHaveProperty('message')
    expect(captured.headers['user-agent']).toBe('GitHub-Hookshot/demo')
  })

  it('POST linear fixture preserves the Linear-Webhook User-Agent', async () => {
    const send = await server.inject({
      method: 'POST',
      url: `/api/inboxes/${inbox.token}/fixtures/linear.issue.updated`,
    })
    expect(send.statusCode).toBe(200)

    const list = await new ListRequests({
      requests: new MongoRequestListReadModel(mockDb.db),
    }).execute({ inboxToken: inbox.token, limit: 50 })

    const captured = list.find((r) => r.headers['user-agent'] === 'Linear-Webhook/1.0')
    expect(captured).toBeDefined()
    const parsed = JSON.parse(captured.body)
    expect(parsed.action).toBe('update')
    expect(parsed.type).toBe('Issue')
    expect(parsed.data.title).toMatch(/Webhook demo inbox/)
    expect(parsed.data.state.name).toBe('In Progress')
  })

  it('returns 400 when fixtureId does not match any registered fixture', async () => {
    const res = await server.inject({
      method: 'POST',
      url: `/api/inboxes/${inbox.token}/fixtures/nope.does.not.exist`,
    })
    expect(res.statusCode).toBe(400)
    expect(JSON.parse(res.body)).toEqual({ error: 'Fixture not found' })
  })

  it('returns 404 when inboxToken does not match any registered inbox', async () => {
    const res = await server.inject({
      method: 'POST',
      url: '/api/inboxes/no-such-token-zzz/fixtures/stripe.payment_intent.succeeded',
    })
    expect(res.statusCode).toBe(404)
    expect(JSON.parse(res.body)).toEqual({ error: 'Inbox not found' })
  })
})
