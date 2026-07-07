import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import Fastify from 'fastify'
import { MongoMemoryServer } from 'mongodb-memory-server'
import { MongoClient, ObjectId } from 'mongodb'

import apiRoute from './infra/http/apiRoute.js'
import { SandboxInbox } from './domain/SandboxInbox.js'
import { MongoInboxRepository } from './infra/persistence/MongoInboxRepository.js'

let memServer
let mongoClient
let db

async function setupMongo() {
  memServer = await MongoMemoryServer.create()
  mongoClient = new MongoClient(memServer.getUri())
  await mongoClient.connect()
  db = mongoClient.db('peekhook-api-idor-test')
  return db
}

async function teardownMongo() {
  if (mongoClient) await mongoClient.close()
  if (memServer)   await memServer.stop()
}

async function buildApiFastify() {
  const sharedDbModule = await import('../shared/db.js')
  sharedDbModule.__setDbForTest(db)
  const fastify = Fastify({ logger: false })
  await fastify.register(apiRoute)
  await fastify.ready()
  return fastify
}

async function insertCapture(token, body) {
  const id = new ObjectId()
  await db.collection('requests').insertOne({
    _id: id,
    inboxToken: token,
    method: 'POST',
    path: '/x',
    query: {},
    headers: {},
    body,
    contentType: 'text/plain',
    size: body.length,
    ip: '127.0.0.1',
    createdAt: new Date(),
    expiresAt: new Date(Date.now() + 60_000),
  })
  return id
}

describe('apiRoute — IDOR audit on read-by-id endpoints', () => {
  beforeAll(async () => { await setupMongo() })
  afterAll(async () => { await teardownMongo() })

  it('GET /api/inboxes/:token/requests/:id only returns captures scoped to that inbox', async () => {
    const inboxRepo = new MongoInboxRepository(db)
    const fastify   = await buildApiFastify()
    const alice = SandboxInbox.create(); await inboxRepo.insert(alice)
    const bob   = SandboxInbox.create(); await inboxRepo.insert(bob)

    const aliceId = await insertCapture(alice.token, 'alice-secret')

    try {
      // Bob guesses alice's ObjectId — must NOT see her capture.
      const bobAttempt = await fastify.inject({
        method: 'GET',
        url:    `/api/inboxes/${bob.token}/requests/${aliceId.toString()}`,
      })
      expect(bobAttempt.statusCode).toBe(404)

      // Alice can read her own capture.
      const aliceOwn = await fastify.inject({
        method: 'GET',
        url:    `/api/inboxes/${alice.token}/requests/${aliceId.toString()}`,
      })
      expect(aliceOwn.statusCode).toBe(200)
      expect(JSON.parse(aliceOwn.body).body).toBe('alice-secret')
    } finally {
      await fastify.close()
    }
  })

  it('GET /api/requests/:id requires ?token=<inboxToken> and a valid shareId (IDOR + share-id entropy)', async () => {
    const inboxRepo = new MongoInboxRepository(db)
    const fastify   = await buildApiFastify()
    const alice = SandboxInbox.create(); await inboxRepo.insert(alice)
    const bob   = SandboxInbox.create(); await inboxRepo.insert(bob)

    const aliceId = await insertCapture(alice.token, 'alice-share-secret')

    try {
      // No token → 400.
      const noToken = await fastify.inject({
        method: 'GET',
        url:    `/api/requests/${aliceId.toString()}`,
      })
      expect(noToken.statusCode).toBe(400)

      // Old ObjectId URL (24 hex) → 404 unconditionally, even with
      // the right token. Leaking an ObjectId is no longer enough to
      // read a capture. Users must click share to mint a fresh
      // shareId. The status code is 404 (not 400) so old browser
      // bookmarks don't surface a client-side validation error to
      // the end user.
      const oldShape = await fastify.inject({
        method: 'GET',
        url:    `/api/requests/${aliceId.toString()}?token=${alice.token}`,
      })
      expect(oldShape.statusCode).toBe(404)

      // Captures minted before the share feature have no shareId.
      // Even with the right token and a 32-hex id, the public
      // endpoint returns 404 because share is opt-in.
      const noShareYet = await fastify.inject({
        method: 'GET',
        url:    `/api/requests/${'0'.repeat(32)}?token=${alice.token}`,
      })
      expect(noShareYet.statusCode).toBe(404)

      // Mint a share id for the capture.
      const minted = await fastify.inject({
        method: 'POST',
        url:    `/api/inboxes/${alice.token}/requests/${aliceId.toString()}/share`,
      })
      expect(minted.statusCode).toBe(200)
      const mintedBody = JSON.parse(minted.body)
      expect(mintedBody.shareUrl).toMatch(new RegExp(`^https?://[^/]+/c/[0-9a-f]{32}\\?token=${alice.token}$`))
      expect(mintedBody.shareId).toMatch(/^[0-9a-f]{32}$/)
      expect(mintedBody.shareId.length).toBe(32)
      const shareId = mintedBody.shareId

      // Right token → 200 with the captured payload.
      const rightToken = await fastify.inject({
        method: 'GET',
        url:    `/api/requests/${shareId}?token=${alice.token}`,
      })
      expect(rightToken.statusCode).toBe(200)
      const body = JSON.parse(rightToken.body)
      expect(body.body).toBe('alice-share-secret')

      // Wrong token → 404 (shareId exists, but for alice's inbox).
      const wrongToken = await fastify.inject({
        method: 'GET',
        url:    `/api/requests/${shareId}?token=${bob.token}`,
      })
      expect(wrongToken.statusCode).toBe(404)

      // Malformed id (not 24 nor 32 hex) → 400.
      const malformed = await fastify.inject({
        method: 'GET',
        url:    `/api/requests/zzz?token=${alice.token}`,
      })
      expect(malformed.statusCode).toBe(400)
    } finally {
      await fastify.close()
    }
  })

  it('POST /api/inboxes/:token/requests/:id/share returns the new share URL contract', async () => {
    const inboxRepo = new MongoInboxRepository(db)
    const fastify   = await buildApiFastify()
    const alice = SandboxInbox.create(); await inboxRepo.insert(alice)

    const aliceId = await insertCapture(alice.token, 'share-me')

    try {
      const minted = await fastify.inject({
        method: 'POST',
        url:    `/api/inboxes/${alice.token}/requests/${aliceId.toString()}/share`,
      })
      expect(minted.statusCode).toBe(200)
      const body = JSON.parse(minted.body)
      expect(body.shareUrl).toMatch(new RegExp(`^https?://[^/]+/c/[0-9a-f]{32}\\?token=${alice.token}$`))
      expect(body.shareId).toMatch(/^[0-9a-f]{32}$/)
      expect(body.shareId.length).toBe(32)
    } finally {
      await fastify.close()
    }
  })

  it('POST share is idempotent: second call returns the same shareId', async () => {
    const inboxRepo = new MongoInboxRepository(db)
    const fastify   = await buildApiFastify()
    const alice = SandboxInbox.create(); await inboxRepo.insert(alice)

    const aliceId = await insertCapture(alice.token, 'share-me-twice')

    try {
      const first = JSON.parse((await fastify.inject({
        method: 'POST',
        url:    `/api/inboxes/${alice.token}/requests/${aliceId.toString()}/share`,
      })).body)
      const second = JSON.parse((await fastify.inject({
        method: 'POST',
        url:    `/api/inboxes/${alice.token}/requests/${aliceId.toString()}/share`,
      })).body)
      expect(second.shareId).toBe(first.shareId)
      expect(second.shareUrl).toBe(first.shareUrl)
    } finally {
      await fastify.close()
    }
  })

  it('POST share returns 404 when the request does not belong to the inbox', async () => {
    const inboxRepo = new MongoInboxRepository(db)
    const fastify   = await buildApiFastify()
    const alice = SandboxInbox.create(); await inboxRepo.insert(alice)

    try {
      const r = await fastify.inject({
        method: 'POST',
        url:    `/api/inboxes/${alice.token}/requests/${'0'.repeat(24)}/share`,
      })
      expect(r.statusCode).toBe(404)
    } finally {
      await fastify.close()
    }
  })
})
