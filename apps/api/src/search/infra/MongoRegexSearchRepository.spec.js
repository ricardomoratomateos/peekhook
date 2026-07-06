import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { ObjectId } from 'mongodb'
import { startMongo, stopMongo } from '../../../test/helpers/mongoMemory.js'
import { SandboxInbox } from '../../inbox/domain/SandboxInbox.js'
import { MongoInboxRepository } from '../../inbox/infra/persistence/MongoInboxRepository.js'
import { MongoRegexSearchRepository } from './MongoRegexSearchRepository.js'
import { SearchField } from '../domain/SearchField.js'

/**
 * Insert N rows for a given inbox at sequential ObjectIds so cursor
 * ordering by `_id` matches insertion ordering regardless of which
 * second on the clock the test ran.
 */
async function seedRows(db, inboxToken, rows) {
  const now = new Date()
  const expiresAt = new Date(now.getTime() + 86_400_000)
  const docs = rows.map((r, i) => ({
    _id: new ObjectId(now.getTime() * 1000 + i),
    inboxToken,
    method:      r.method      ?? 'POST',
    path:        r.path,
    query:       r.query       ?? {},
    headers:     r.headers     ?? {},
    body:        r.body        ?? '',
    contentType: r.contentType ?? 'application/json',
    size:        r.size        ?? Buffer.byteLength(r.body ?? '', 'utf8'),
    ip:          r.ip          ?? '127.0.0.1',
    createdAt:   new Date(now.getTime() + i),
    expiresAt,
  }))
  await db.collection('requests').insertMany(docs)
  return docs
}

describe('MongoRegexSearchRepository', () => {
  let db
  let repo
  let inboxToken

  beforeAll(async () => {
    db = await startMongo()
    repo = new MongoRegexSearchRepository(db)

    const inbox = SandboxInbox.create()
    await new MongoInboxRepository(db).insert(inbox)
    inboxToken = inbox.token

    await seedRows(db, inboxToken, [
      { id: 'r1', path: '/webhooks/stripe', headers: { 'user-agent': 'Stripe-Webhook' },
        body: '{"id":"evt_1","type":"charge.succeeded"}' },
      { id: 'r2', path: '/webhooks/github', headers: { 'user-agent': 'GitHub-Hookshot' },
        body: '{"ref":"main"}' },
      { id: 'r3', path: '/webhooks/stripe', headers: { 'user-agent': 'Stripe-Webhook' },
        body: '{"id":"evt_2","type":"charge.failed"}' },
    ])
  })

  afterAll(async () => { await stopMongo() })

  it('matches 2 of 3 inserted documents when field=path', async () => {
    const dtos = await repo.search({
      inboxToken,
      regex: 'stripe',
      field:  SearchField.parse('path'),
    })
    const orderedIds = dtos.map((d) => d.path)
    expect(orderedIds).toEqual(['/webhooks/stripe', '/webhooks/stripe'])
  })

  it('matches documents whose body contains the regex when field=body', async () => {
    const dtos = await repo.search({
      inboxToken,
      regex: 'charge',
      field:  SearchField.parse('body'),
    })
    expect(dtos.map((d) => d.body)).toEqual([
      '{"id":"evt_2","type":"charge.failed"}',
      '{"id":"evt_1","type":"charge.succeeded"}',
    ])
  })

  it('matches documents by header value when field=header:user-agent', async () => {
    const dtos = await repo.search({
      inboxToken,
      regex: 'GitHub',
      field:  SearchField.parse('header:user-agent'),
    })
    expect(dtos.map((d) => d.path)).toEqual(['/webhooks/github'])
  })

  it('returns [] for an inbox with matching documents under a different inbox token', async () => {
    const dtos = await repo.search({
      inboxToken: 'inb_other',
      regex:      'stripe',
      field:      SearchField.parse('path'),
    })
    expect(dtos).toEqual([])
  })

  it('caps to a default of 50 when no limit is provided', async () => {
    const dtos = await repo.search({
      inboxToken,
      regex: '.',
      field:  SearchField.parse('path'),
    })
    expect(dtos.length).toBeLessThanOrEqual(50)
    expect(dtos.length).toBe(3)
  })

  it('respects an explicit limit lower than the seed size', async () => {
    const dtos = await repo.search({
      inboxToken,
      regex: '.',
      field:  SearchField.parse('path'),
      limit:  2,
    })
    expect(dtos).toHaveLength(2)
  })

  it('paginates with the before cursor — first page newest-first, then older', async () => {
    const all = await repo.search({
      inboxToken,
      regex: '.',
      field:  SearchField.parse('path'),
    })
    expect(all).toHaveLength(3)

    const cursorId = all[1].id
    const older = await repo.search({
      inboxToken,
      regex:  '.',
      field:  SearchField.parse('path'),
      before: cursorId,
    })
    expect(older).toHaveLength(1)
    expect(older[0].id).toBe(all[2].id)
  })

  it('ignores an invalid before cursor without throwing', async () => {
    const dtos = await repo.search({
      inboxToken,
      regex:  '.',
      field:  SearchField.parse('path'),
      before: 'not-a-real-objectid',
    })
    expect(dtos).toHaveLength(3)
  })

  it('produces DTOs with the same shape as MongoRequestListReadModel', async () => {
    const dtos = await repo.search({
      inboxToken,
      regex: 'stripe',
      field:  SearchField.parse('path'),
    })

    expect(dtos[0]).toEqual({
      id:               expect.any(String),
      method:           expect.any(String),
      path:             expect.any(String),
      query:            expect.any(Object),
      headers:          expect.any(Object),
      body:             expect.any(String),
      contentType:      expect.any(String),
      size:             expect.any(Number),
      ip:               expect.any(String),
      createdAt:        expect.any(Date),
      upstreamResponse: null,
    })
    expect(dtos[0].id).toMatch(/^[0-9a-f]{24}$/)
    expect(dtos[0]).not.toHaveProperty('inboxToken')
    expect(dtos[0]).not.toHaveProperty('expiresAt')
    expect(dtos[0]).not.toHaveProperty('_id')
  })
})
