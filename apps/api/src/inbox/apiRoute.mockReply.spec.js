import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import Fastify from 'fastify'
import { MongoMemoryServer } from 'mongodb-memory-server'
import { MongoClient } from 'mongodb'

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
  db = mongoClient.db('peekhook-mock-reply-test')
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

async function putReply(fastify, inbox, responseConfig) {
  return await fastify.inject({
    method:  'PUT',
    url:     `/api/inboxes/${inbox.token}/response`,
    headers: { 'content-type': 'application/json' },
    payload:  responseConfig,
  })
}

describe('PUT /api/inboxes/:token/response — mock reply security', () => {
  beforeAll(async () => { await setupMongo() })
  afterAll(async () => { await teardownMongo() })

  it('accepts a baseline valid mock-reply (application/json)', async () => {
    const inbox = SandboxInbox.create()
    await new MongoInboxRepository(db).insert(inbox)
    const fastify = await buildApiFastify()
    try {
      const res = await putReply(fastify, inbox, {
        enabled:     true,
        status:      200,
        contentType: 'application/json',
        body:        '{"ok":true}',
      })
      expect(res.statusCode).toBe(200)
      const body = JSON.parse(res.body)
      expect(body.responseConfig.contentType).toBe('application/json')
    } finally {
      await fastify.close()
    }
  })

  it('accepts all four allowlisted content-types via the HTTP route', async () => {
    const fastify = await buildApiFastify()
    try {
      for (const ct of ['text/plain', 'application/json', 'application/xml', 'text/html']) {
        const inbox = SandboxInbox.create()
        await new MongoInboxRepository(db).insert(inbox)
        const res = await putReply(fastify, inbox, {
          enabled: true, status: 200, contentType: ct, body: 'hi',
        })
        expect(res.statusCode).toBe(200)
      }
    } finally {
      await fastify.close()
    }
  })

  it('rejects content-type with CRLF injection attempt (400)', async () => {
    const inbox = SandboxInbox.create()
    await new MongoInboxRepository(db).insert(inbox)
    const fastify = await buildApiFastify()
    try {
      const res = await putReply(fastify, inbox, {
        enabled:     true,
        status:      200,
        contentType: 'text/html\r\nSet-Cookie: x=y',
        body:        'hi',
      })
      expect(res.statusCode).toBe(400)
      const body = JSON.parse(res.body)
      expect(body.error).toMatch(/CR or LF/)
    } finally {
      await fastify.close()
    }
  })

  it('rejects content-type with bare LF injection attempt (400)', async () => {
    const inbox = SandboxInbox.create()
    await new MongoInboxRepository(db).insert(inbox)
    const fastify = await buildApiFastify()
    try {
      const res = await putReply(fastify, inbox, {
        enabled:     true,
        status:      200,
        contentType: 'text/plain\nSet-Cookie: x=y',
        body:        'hi',
      })
      expect(res.statusCode).toBe(400)
    } finally {
      await fastify.close()
    }
  })

  it('rejects application/javascript content-type (XSS smuggling surface)', async () => {
    const inbox = SandboxInbox.create()
    await new MongoInboxRepository(db).insert(inbox)
    const fastify = await buildApiFastify()
    try {
      const res = await putReply(fastify, inbox, {
        enabled:     true,
        status:      200,
        contentType: 'application/javascript',
        body:        'alert(1)',
      })
      expect(res.statusCode).toBe(400)
      const body = JSON.parse(res.body)
      expect(body.error).toMatch(/text\/plain, application\/json/)
    } finally {
      await fastify.close()
    }
  })

  it('rejects application/octet-stream content-type (binary smuggling)', async () => {
    const inbox = SandboxInbox.create()
    await new MongoInboxRepository(db).insert(inbox)
    const fastify = await buildApiFastify()
    try {
      const res = await putReply(fastify, inbox, {
        enabled:     true,
        status:      200,
        contentType: 'application/octet-stream',
        body:        'binary-blob',
      })
      expect(res.statusCode).toBe(400)
    } finally {
      await fastify.close()
    }
  })

  it('accepts a 64 KB mock body (boundary case)', async () => {
    const inbox = SandboxInbox.create()
    await new MongoInboxRepository(db).insert(inbox)
    const fastify = await buildApiFastify()
    try {
      const body = 'a'.repeat(64 * 1024)
      const res = await putReply(fastify, inbox, {
        enabled: true, status: 200, contentType: 'text/plain', body,
      })
      expect(res.statusCode).toBe(200)
      const persisted = await db.collection('inboxes').findOne({ token: inbox.token })
      expect(persisted.mockBodySize).toBe(64 * 1024)
    } finally {
      await fastify.close()
    }
  })

  it('rejects a 65 KB mock body (over the cap)', async () => {
    const inbox = SandboxInbox.create()
    await new MongoInboxRepository(db).insert(inbox)
    const fastify = await buildApiFastify()
    try {
      const body = 'a'.repeat(65 * 1024)
      const res = await putReply(fastify, inbox, {
        enabled: true, status: 200, contentType: 'text/plain', body,
      })
      expect(res.statusCode).toBe(400)
      const parsed = JSON.parse(res.body)
      expect(parsed.error).toMatch(/65536 byte limit/)
    } finally {
      await fastify.close()
    }
  })

  it('accepts a default mock reply with empty body', async () => {
    const inbox = SandboxInbox.create()
    await new MongoInboxRepository(db).insert(inbox)
    const fastify = await buildApiFastify()
    try {
      const res = await putReply(fastify, inbox, {
        enabled: true, status: 200, contentType: 'application/json', body: '',
      })
      expect(res.statusCode).toBe(200)
      const persisted = await db.collection('inboxes').findOne({ token: inbox.token })
      expect(persisted.mockBodySize).toBe(0)
    } finally {
      await fastify.close()
    }
  })

  it('persists mockBodySize on the inbox document', async () => {
    const inbox = SandboxInbox.create()
    await new MongoInboxRepository(db).insert(inbox)
    const fastify = await buildApiFastify()
    try {
      const body = 'hello world'
      const res = await putReply(fastify, inbox, {
        enabled: true, status: 200, contentType: 'text/plain', body,
      })
      expect(res.statusCode).toBe(200)

      const persisted = await db.collection('inboxes').findOne({ token: inbox.token })
      expect(persisted.mockBodySize).toBe(Buffer.byteLength(body, 'utf8'))
      expect(persisted.responseConfig.body).toBe(body)
    } finally {
      await fastify.close()
    }
  })

  it('clears mockBodySize back to 0 when the reply is deleted', async () => {
    const inbox = SandboxInbox.create()
    await new MongoInboxRepository(db).insert(inbox)
    const fastify = await buildApiFastify()
    try {
      await putReply(fastify, inbox, {
        enabled: true, status: 200, contentType: 'text/plain', body: 'set',
      })

      const del = await fastify.inject({
        method: 'DELETE',
        url:    `/api/inboxes/${inbox.token}/response`,
      })
      expect(del.statusCode).toBe(200)

      const persisted = await db.collection('inboxes').findOne({ token: inbox.token })
      expect(persisted.mockBodySize).toBe(0)
    } finally {
      await fastify.close()
    }
  })
})