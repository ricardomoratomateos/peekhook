import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import Fastify from 'fastify'
import { MongoMemoryServer } from 'mongodb-memory-server'
import { MongoClient } from 'mongodb'
import { SandboxInbox } from '../../inbox/domain/SandboxInbox.js'
import { CapturedRequest } from '../../inbox/domain/CapturedRequest.js'
import { MongoInboxRepository } from '../../inbox/infra/persistence/MongoInboxRepository.js'
import { MongoCapturedRequestRepository } from '../../inbox/infra/persistence/MongoCapturedRequestRepository.js'
import { MongoRequestListReadModel } from '../../inbox/infra/persistence/MongoRequestListReadModel.js'
import { runScript } from '../../scripting/index.js'
import { ReplayEvent } from '../app/ReplayEvent.js'
import { InMemoryReplayRateLimiter } from './InMemoryReplayRateLimiter.js'
import { REPLAY_HEADER, REPLAY_HEADER_VALUE } from '../domain/ReplayOutcome.js'
import registerReplayRoutes from './replay.http.js'

let memServer
let mongoClient
let db

async function setupMongo() {
  memServer = await MongoMemoryServer.create()
  mongoClient = new MongoClient(memServer.getUri())
  await mongoClient.connect()
  db = mongoClient.db('peekhook-replay-test')
  return db
}

async function teardownMongo() {
  if (mongoClient) await mongoClient.close()
  if (memServer)   await memServer.stop()
}

/**
 * Each scenario builds its own Fastify instance with a fresh
 * in-memory rate limiter so bucket state can't bleed across tests.
 * The real Mongo repos share the same in-memory db.
 */
async function buildServer({ withRunScript = true } = {}) {
  const inboxes   = new MongoInboxRepository(db)
  const captured  = new MongoCapturedRequestRepository(db)
  const readModel = new MongoRequestListReadModel(db)

  const inbox = SandboxInbox.create()
  await inboxes.insert(inbox)

  const id = captured.nextId()
  await captured.insert(CapturedRequest.create({
    id,
    inboxToken:  inbox.token,
    method:      'POST',
    path:        '/i/' + inbox.token,
    query:       {},
    headers:     { 'content-type': 'application/json' },
    body:        '{"hello":"world"}',
    contentType: 'application/json',
    size:        17,
    ip:          '127.0.0.1',
    now:         new Date(),
    expiresAt:   inbox.expiresAt,
  }))

  const limiter = new InMemoryReplayRateLimiter()
  const replayEvent = new ReplayEvent({
    inboxes:     inboxes,
    requests:    readModel,
    rateLimiter: limiter,
    runScript:   withRunScript ? runScript : null,
  })

  const fastify = Fastify({ logger: false })
  await fastify.register(registerReplayRoutes, { replayEvent })
  await fastify.ready()

  return { fastify, inbox, eventId: id.toString(), inboxes }
}

describe('replay integration (Fastify inject + memory Mongo)', () => {
  beforeAll(async () => { await setupMongo() })
  afterAll(async () => { await teardownMongo() })

  it('returns 200 with the configured body and X-Peek-Replay: 1', async () => {
    const { fastify, inbox, eventId, inboxes } = await buildServer()
    try {
      await inboxes.updateResponseConfig(inbox.token, {
        enabled:     true,
        status:      201,
        contentType: 'text/plain',
        body:        'mocked reply',
      })

      const response = await fastify.inject({
        method:  'POST',
        url:     `/api/inboxes/${inbox.token}/replay`,
        headers: { 'content-type': 'application/json' },
        payload:  JSON.stringify({ eventId, mockOnly: true }),
      })

      expect(response.statusCode).toBe(200)
      expect(response.headers[REPLAY_HEADER.toLowerCase()]).toBe(REPLAY_HEADER_VALUE)
      const body = JSON.parse(response.body)
      expect(body.token).toBe(inbox.token)
      expect(body.replayed.status).toBe(201)
      expect(body.replayed.contentType).toBe('text/plain')
      expect(body.replayed.body).toBe('mocked reply')
      expect(body.replayed.headers[REPLAY_HEADER]).toBe(REPLAY_HEADER_VALUE)
      expect(typeof body.replayed.replayedAt).toBe('string')
    } finally {
      await fastify.close()
    }
  })

  it('returns 429 when the same inbox replays twice within a minute', async () => {
    const { fastify, inbox, eventId } = await buildServer()
    try {
      const first = await fastify.inject({
        method:  'POST',
        url:     `/api/inboxes/${inbox.token}/replay`,
        headers: { 'content-type': 'application/json' },
        payload:  JSON.stringify({ eventId, mockOnly: true }),
      })
      expect(first.statusCode).toBe(200)

      const second = await fastify.inject({
        method:  'POST',
        url:     `/api/inboxes/${inbox.token}/replay`,
        headers: { 'content-type': 'application/json' },
        payload:  JSON.stringify({ eventId, mockOnly: true }),
      })
      expect(second.statusCode).toBe(429)
      expect(second.headers[REPLAY_HEADER.toLowerCase()]).toBe(REPLAY_HEADER_VALUE)
      expect(second.headers['retry-after']).toBeDefined()
      const body = JSON.parse(second.body)
      expect(body.error).toMatch(/rate limit/i)
      expect(typeof body.retryAfterSec).toBe('number')
    } finally {
      await fastify.close()
    }
  })

  it('returns 400 when mockOnly=false', async () => {
    const { fastify, inbox, eventId } = await buildServer()
    try {
      const response = await fastify.inject({
        method:  'POST',
        url:     `/api/inboxes/${inbox.token}/replay`,
        headers: { 'content-type': 'application/json' },
        payload:  JSON.stringify({ eventId, mockOnly: false }),
      })
      expect(response.statusCode).toBe(400)
      const body = JSON.parse(response.body)
      expect(body.error).toMatch(/mockOnly must be true/)
    } finally {
      await fastify.close()
    }
  })

  it('returns 404 when the event id does not exist for the inbox', async () => {
    const { fastify, inbox } = await buildServer()
    try {
      const response = await fastify.inject({
        method:  'POST',
        url:     `/api/inboxes/${inbox.token}/replay`,
        headers: { 'content-type': 'application/json' },
        payload:  JSON.stringify({ eventId: '6f1d2b3c4d5e6f7a8b9c0d1e', mockOnly: true }),
      })
      expect(response.statusCode).toBe(404)
      const body = JSON.parse(response.body)
      expect(body.error).toMatch(/inbox or event not found/i)
    } finally {
      await fastify.close()
    }
  })

  it('returns 400 when eventId is missing', async () => {
    const { fastify, inbox } = await buildServer()
    try {
      const response = await fastify.inject({
        method:  'POST',
        url:     `/api/inboxes/${inbox.token}/replay`,
        headers: { 'content-type': 'application/json' },
        payload:  JSON.stringify({ mockOnly: true }),
      })
      expect(response.statusCode).toBe(400)
      const body = JSON.parse(response.body)
      expect(body.error).toMatch(/eventId/)
    } finally {
      await fastify.close()
    }
  })
})
