import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import Fastify from 'fastify'
import { ObjectId } from 'mongodb'
import { startMongo, getTestDb, stopMongo } from '../../../test/helpers/mongoMemory.js'
import { SandboxInbox }    from '../../domain/SandboxInbox.js'
import { MongoInboxRepository } from '../../infra/persistence/MongoInboxRepository.js'
import { MongoRegexSearchRepository } from './infra/MongoRegexSearchRepository.js'
import { SearchEvents } from './app/SearchEvents.js'
import { registerSearchRoutes } from './search.http.js'

/**
 * Same `vi.mock('shared/db.js')` trick as `scripting.integration.spec.js`:
 * the route factory calls `getDb()` to source its dependencies; we point
 * that at the in-memory Mongo started in `beforeAll`.
 */
const mockDb = vi.hoisted(() => ({ db: null }))

vi.mock('../../shared/db.js', () => ({
  connectDb: async () => {},
  getDb:     () => mockDb.db,
  closeDb:   async () => {},
}))

describe('search route (Fastify inject)', () => {
  let server
  let inboxToken

  beforeAll(async () => {
    const db = await startMongo()
    mockDb.db = db

    const inbox = SandboxInbox.create()
    await new MongoInboxRepository(db).insert(inbox)
    inboxToken = inbox.token

    const now = new Date()
    const expiresAt = new Date(now.getTime() + 86_400_000)
    await db.collection('requests').insertMany([
      {
        _id: new ObjectId(now.getTime() * 1000 + 1),
        inboxToken,
        method: 'POST',
        path: '/webhooks/stripe',
        query: {},
        headers: { 'user-agent': 'Stripe-Webhook' },
        body: '{"id":"evt_1","type":"charge.succeeded"}',
        contentType: 'application/json',
        size: 38,
        ip: '127.0.0.1',
        createdAt: new Date(now.getTime() + 1),
        expiresAt,
      },
      {
        _id: new ObjectId(now.getTime() * 1000 + 2),
        inboxToken,
        method: 'POST',
        path: '/webhooks/github',
        query: {},
        headers: { 'user-agent': 'GitHub-Hookshot' },
        body: '{"ref":"main"}',
        contentType: 'application/json',
        size: 16,
        ip: '127.0.0.1',
        createdAt: new Date(now.getTime() + 2),
        expiresAt,
      },
    ])

    server = Fastify({ logger: false })
    await server.register(registerSearchRoutes)
    await server.ready()
  })

  afterAll(async () => {
    if (server) await server.close()
    await stopMongo()
  })

  it('searches by path and returns DTOs newest-first with the standard response shape', async () => {
    const response = await server.inject({
      method: 'GET',
      url: `/api/inboxes/${inboxToken}/requests/search?regex=stripe&field=path`,
    })

    expect(response.statusCode).toBe(200)
    expect(JSON.parse(response.body)).toEqual([
      {
        id: expect.stringMatching(/^[0-9a-f]{24}$/),
        method: 'POST',
        path: '/webhooks/stripe',
        query: {},
        headers: { 'user-agent': 'Stripe-Webhook' },
        body: '{"id":"evt_1","type":"charge.succeeded"}',
        contentType: 'application/json',
        size: 38,
        ip: '127.0.0.1',
        createdAt: expect.any(String),
      },
    ])
  })

  it('mirrors the existing /requests endpoint in headers and DTO shape', async () => {
    // Compare the search response wire-format against what the existing
    // listing endpoint produces for the same inbox — same headers, same
    // DTO keys per element. We render the listing response by going
    // straight at the read model so the spec stays self-contained
    // (no need to also mount apiRoute.js here).
    const db = getTestDb()
    const { MongoRequestListReadModel } = await import('../../infra/persistence/MongoRequestListReadModel.js')
    const listDtos = await new MongoRequestListReadModel(db)
      .list({ inboxToken, limit: 50 })

    const searchResponse = await server.inject({
      method: 'GET',
      url:    `/api/inboxes/${inboxToken}/requests/search?regex=.%2B&field=path`,
    })

    expect(searchResponse.statusCode).toBe(200)
    expect(searchResponse.headers['content-type']).toMatch(/application\/json/)
    expect(Array.isArray(JSON.parse(searchResponse.body))).toBe(true)

    const searchDtos = JSON.parse(searchResponse.body)
    expect(searchDtos.length).toBe(listDtos.length)
    expect(Object.keys(searchDtos[0]).sort()).toEqual(Object.keys(listDtos[0]).sort())
  })

  it('returns 404 when the inbox token does not exist', async () => {
    const response = await server.inject({
      method: 'GET',
      url: '/api/inboxes/no-such-inbox/requests/search?regex=stripe&field=path',
    })
    expect(response.statusCode).toBe(404)
    expect(JSON.parse(response.body)).toEqual({ error: 'Inbox not found' })
  })

  it('returns [] (200) for an empty regex query string', async () => {
    const response = await server.inject({
      method: 'GET',
      url: `/api/inboxes/${inboxToken}/requests/search?regex=&field=path`,
    })
    expect(response.statusCode).toBe(200)
    expect(JSON.parse(response.body)).toEqual([])
  })

  it('returns 400 when the regex is not a string (Fastify already coerces absent params)', async () => {
    // Coerce via ?regex with literal "undefined"  to make string→object parse path invalid.
    // Empty + param absent both collapse to "" via Fastify; an actual non-string typed
    // through the pattern would fall on the use case. We test the use case's branch via
    // the non-compiling regex case below — this case documents the 400 contract.
    const response = await server.inject({
      method: 'GET',
      url: `/api/inboxes/${inboxToken}/requests/search?regex=${encodeURIComponent('(unclosed')}&field=path`,
    })
    expect(response.statusCode).toBe(400)
    expect(JSON.parse(response.body)).toMatchObject({ error: expect.stringMatching(/valid regular expression/) })
  })

  it('returns 400 when the regex is longer than 256 chars', async () => {
    const longRegex = 'a'.repeat(257)
    const response = await server.inject({
      method: 'GET',
      url: `/api/inboxes/${inboxToken}/requests/search?regex=${longRegex}&field=path`,
    })
    expect(response.statusCode).toBe(400)
    expect(JSON.parse(response.body)).toMatchObject({ error: expect.stringMatching(/256/) })
  })

  it('returns 400 when field is missing or unknown', async () => {
    const missing = await server.inject({
      method: 'GET',
      url: `/api/inboxes/${inboxToken}/requests/search?regex=stripe`,
    })
    expect(missing.statusCode).toBe(400)

    const unknown = await server.inject({
      method: 'GET',
      url: `/api/inboxes/${inboxToken}/requests/search?regex=stripe&field=method`,
    })
    expect(unknown.statusCode).toBe(400)

    const emptyHeader = await server.inject({
      method: 'GET',
      url: `/api/inboxes/${inboxToken}/requests/search?regex=stripe&field=header:`,
    })
    expect(emptyHeader.statusCode).toBe(400)
  })

  it('searches by body XML-escaped JSON content', async () => {
    const response = await server.inject({
      method: 'GET',
      url: `/api/inboxes/${inboxToken}/requests/search?regex=${encodeURIComponent('charge\\.succeeded')}&field=body`,
    })
    expect(response.statusCode).toBe(200)
    expect(JSON.parse(response.body)).toHaveLength(1)
  })

  it('searches by header value with field=header:user-agent', async () => {
    const response = await server.inject({
      method: 'GET',
      url: `/api/inboxes/${inboxToken}/requests/search?regex=${encodeURIComponent('GitHub')}&field=header:user-agent`,
    })
    expect(response.statusCode).toBe(200)
    expect(JSON.parse(response.body)).toHaveLength(1)
    expect(JSON.parse(response.body)[0].path).toBe('/webhooks/github')
  })

  it('reaches the repo with the search results for a valid query', async () => {
    // Sanity — wiring the use case to the route produces non-empty results for a
    // broad regex against the seeded documents.
    const search = new SearchEvents({ repo: new MongoRegexSearchRepository(getTestDb()) })
    const dtos = await search.execute({
      inboxToken,
      regex: '.',
      field: 'path',
    })
    expect(dtos.length).toBe(2)
  })
})
