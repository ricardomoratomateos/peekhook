import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import Fastify from 'fastify'
import { MongoMemoryServer } from 'mongodb-memory-server'
import { MongoClient } from 'mongodb'

import apiRoute from './infra/http/apiRoute.js'
import { SandboxInbox } from './domain/SandboxInbox.js'
import { CapturedRequest } from './domain/CapturedRequest.js'
import { MongoInboxRepository } from './infra/persistence/MongoInboxRepository.js'
import { MongoCapturedRequestRepository } from './infra/persistence/MongoCapturedRequestRepository.js'

let memServer
let mongoClient
let db

async function setupMongo() {
  memServer = await MongoMemoryServer.create()
  mongoClient = new MongoClient(memServer.getUri())
  await mongoClient.connect()
  db = mongoClient.db('peekhook-export-clear-test')
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

async function seedInbox({ captures = 0 } = {}) {
  const inbox = SandboxInbox.create()
  await new MongoInboxRepository(db).insert(inbox)
  const repo = new MongoCapturedRequestRepository(db)
  for (let i = 0; i < captures; i++) {
    await repo.insert(CapturedRequest.create({
      id:          repo.nextId(),
      inboxToken:  inbox.token,
      method:      'POST',
      path:        `/i/${inbox.token}`,
      query:       {},
      headers:     { 'content-type': 'application/json' },
      body:        `{"n":${i}}`,
      contentType: 'application/json',
      size:        8,
      ip:          '127.0.0.1',
      now:         new Date(),
      expiresAt:   inbox.expiresAt,
    }))
  }
  return inbox
}

describe('GET /api/inboxes/:token/export', () => {
  beforeAll(async () => { await setupMongo() })
  afterAll(async () => { await teardownMongo() })

  it('returns every capture as a downloadable JSON document', async () => {
    const inbox = await seedInbox({ captures: 3 })
    const fastify = await buildApiFastify()
    try {
      const res = await fastify.inject({ method: 'GET', url: `/api/inboxes/${inbox.token}/export` })
      expect(res.statusCode).toBe(200)
      expect(res.headers['content-disposition']).toContain('attachment')
      expect(res.headers['content-disposition']).toContain(`${inbox.token}`)
      const body = JSON.parse(res.body)
      expect(body.inbox.token).toBe(inbox.token)
      expect(typeof body.inbox.exportedAt).toBe('string')
      expect(body.count).toBe(3)
      expect(body.events).toHaveLength(3)
      expect(body.events[0]).toHaveProperty('method', 'POST')
    } finally {
      await fastify.close()
    }
  })

  it('exports only the selected ids when ?ids= is given', async () => {
    const inbox = await seedInbox({ captures: 4 })
    const fastify = await buildApiFastify()
    try {
      const all = JSON.parse((await fastify.inject({ method: 'GET', url: `/api/inboxes/${inbox.token}/export` })).body)
      const wanted = [all.events[0].id, all.events[2].id]
      const res = await fastify.inject({
        method: 'GET',
        url: `/api/inboxes/${inbox.token}/export?ids=${wanted.join(',')}`,
      })
      expect(res.statusCode).toBe(200)
      const body = JSON.parse(res.body)
      expect(body.count).toBe(2)
      expect(body.events.map(e => e.id).sort()).toEqual([...wanted].sort())
    } finally {
      await fastify.close()
    }
  })

  it('404s for an unknown inbox', async () => {
    const fastify = await buildApiFastify()
    try {
      const res = await fastify.inject({ method: 'GET', url: '/api/inboxes/nope/export' })
      expect(res.statusCode).toBe(404)
    } finally {
      await fastify.close()
    }
  })
})

describe('DELETE /api/inboxes/:token/requests', () => {
  beforeAll(async () => { await setupMongo() })
  afterAll(async () => { await teardownMongo() })

  it('purges captures and reports the deleted count', async () => {
    const inbox = await seedInbox({ captures: 4 })
    const fastify = await buildApiFastify()
    try {
      const res = await fastify.inject({ method: 'DELETE', url: `/api/inboxes/${inbox.token}/requests` })
      expect(res.statusCode).toBe(200)
      const body = JSON.parse(res.body)
      expect(body.token).toBe(inbox.token)
      expect(body.deleted).toBe(4)

      const list = await fastify.inject({ method: 'GET', url: `/api/inboxes/${inbox.token}/requests` })
      expect(JSON.parse(list.body)).toHaveLength(0)
    } finally {
      await fastify.close()
    }
  })

  it('deletes only the selected ids and leaves the rest (and the cap) intact', async () => {
    const inbox = await seedInbox({ captures: 5 })
    // Simulate a partially-filled lifetime counter.
    await db.collection('inboxes').updateOne({ token: inbox.token }, { $set: { captureCount: 5 } })
    const fastify = await buildApiFastify()
    try {
      const all = JSON.parse((await fastify.inject({ method: 'GET', url: `/api/inboxes/${inbox.token}/requests` })).body)
      const toDelete = [all[0].id, all[1].id]
      const res = await fastify.inject({
        method: 'DELETE',
        url: `/api/inboxes/${inbox.token}/requests`,
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({ ids: toDelete }),
      })
      expect(res.statusCode).toBe(200)
      expect(JSON.parse(res.body).deleted).toBe(2)

      const remaining = JSON.parse((await fastify.inject({ method: 'GET', url: `/api/inboxes/${inbox.token}/requests` })).body)
      expect(remaining).toHaveLength(3)
      // Selective delete must NOT reset the lifetime capture counter.
      const inboxDoc = await new MongoInboxRepository(db).findByToken(inbox.token)
      expect(inboxDoc.captureCount).toBe(5)
    } finally {
      await fastify.close()
    }
  })

  it('resets the lifetime capture counter so the cap frees up', async () => {
    const inbox = await seedInbox({ captures: 2 })
    const repo = new MongoInboxRepository(db)
    // Simulate a filled inbox.
    await db.collection('inboxes').updateOne({ token: inbox.token }, { $set: { captureCount: 1000 } })

    const fastify = await buildApiFastify()
    try {
      await fastify.inject({ method: 'DELETE', url: `/api/inboxes/${inbox.token}/requests` })
      const after = await repo.findByToken(inbox.token)
      expect(after.captureCount).toBe(0)
      expect(after.rateWindow.count).toBe(0)
    } finally {
      await fastify.close()
    }
  })

  it('404s for an unknown inbox', async () => {
    const fastify = await buildApiFastify()
    try {
      const res = await fastify.inject({ method: 'DELETE', url: '/api/inboxes/nope/requests' })
      expect(res.statusCode).toBe(404)
    } finally {
      await fastify.close()
    }
  })
})

describe('POST /api/inboxes/:token/requests/:id/share — shareBase', () => {
  beforeAll(async () => { await setupMongo() })
  afterAll(async () => { await teardownMongo() })

  async function buildWithShareBase(shareBaseUrl) {
    const sharedDbModule = await import('../shared/db.js')
    sharedDbModule.__setDbForTest(db)
    const fastify = Fastify({ logger: false })
    if (shareBaseUrl !== undefined) fastify.decorate('shareBase', { url: shareBaseUrl })
    await fastify.register(apiRoute)
    await fastify.ready()
    return fastify
  }

  async function firstCaptureId(fastify, token) {
    const list = JSON.parse((await fastify.inject({ method: 'GET', url: `/api/inboxes/${token}/requests` })).body)
    return list[0].id
  }

  it('builds the share URL against a configured public base (peekgrok → ngrok)', async () => {
    const inbox = await seedInbox({ captures: 1 })
    const fastify = await buildWithShareBase('https://my-app.ngrok.app')
    try {
      const id = await firstCaptureId(fastify, inbox.token)
      const res = await fastify.inject({ method: 'POST', url: `/api/inboxes/${inbox.token}/requests/${id}/share`, payload: '{}', headers: { 'content-type': 'application/json' } })
      expect(res.statusCode).toBe(200)
      const body = JSON.parse(res.body)
      expect(body.shareUrl.startsWith('https://my-app.ngrok.app/c/')).toBe(true)
      expect(body.shareUrl).toContain(`?token=${inbox.token}`)
    } finally {
      await fastify.close()
    }
  })

  it('falls back to the request host when no shareBase is set (hosted target)', async () => {
    const inbox = await seedInbox({ captures: 1 })
    const fastify = await buildWithShareBase(undefined)
    try {
      const id = await firstCaptureId(fastify, inbox.token)
      const res = await fastify.inject({
        method: 'POST',
        url: `/api/inboxes/${inbox.token}/requests/${id}/share`,
        payload: '{}',
        headers: { 'content-type': 'application/json', host: 'peekhook.0311b.com' },
      })
      expect(res.statusCode).toBe(200)
      const body = JSON.parse(res.body)
      expect(body.shareUrl.startsWith('http://peekhook.0311b.com/c/')).toBe(true)
    } finally {
      await fastify.close()
    }
  })
})
