/**
 * SQLite (peekgrok) coverage for the clear-inbox + export + listAll
 * repository methods added alongside the new inspector actions.
 *
 * Runs under Bun's test runner (bun:sqlite). Placed under tests/ so the
 * Node/vitest include glob never loads it. To execute:
 *
 *     cd apps/api && bun test tests/sqlite-clear-export.integration.spec.js
 */
import { describe, it, expect } from 'vitest'
import { Database } from 'bun:sqlite'
import { SqliteInboxRepository, migrate as migrateInbox } from '../src/inbox/infra/persistence/SqliteInboxRepository.js'
import { SqliteCapturedRequestRepository, migrate as migrateCaptured } from '../src/inbox/infra/persistence/SqliteCapturedRequestRepository.js'
import { SqliteRequestListReadModel } from '../src/inbox/infra/persistence/SqliteRequestListReadModel.js'
import { SandboxInbox } from '../src/inbox/domain/SandboxInbox.js'
import { CapturedRequest } from '../src/inbox/domain/CapturedRequest.js'

function freshDb() {
  const db = new Database(':memory:')
  migrateInbox(db)
  migrateCaptured(db)
  return db
}

async function seed(db, { captures = 0 } = {}) {
  const inboxes = new SqliteInboxRepository(db)
  const captured = new SqliteCapturedRequestRepository(db)
  const inbox = SandboxInbox.create()
  await inboxes.insert(inbox)
  for (let i = 0; i < captures; i++) {
    await captured.insert(CapturedRequest.create({
      id:          captured.nextId(),
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
  return { inbox, inboxes, captured }
}

describe('SQLite clear + export + listAll', () => {
  it('listAll returns every capture for the inbox', async () => {
    const db = freshDb()
    const { inbox } = await seed(db, { captures: 5 })
    const readModel = new SqliteRequestListReadModel(db)
    const all = await readModel.listAll({ inboxToken: inbox.token })
    expect(all).toHaveLength(5)
    // Intra-second id ordering is random-suffix-based in SQLite, so assert
    // the set is complete rather than a specific order.
    expect(all.map(r => r.body).sort()).toEqual(['{"n":0}', '{"n":1}', '{"n":2}', '{"n":3}', '{"n":4}'])
  })

  it('deleteByInboxToken purges captures and returns the count', async () => {
    const db = freshDb()
    const { inbox, captured } = await seed(db, { captures: 3 })
    const deleted = await captured.deleteByInboxToken(inbox.token)
    expect(deleted).toBe(3)
    const readModel = new SqliteRequestListReadModel(db)
    expect(await readModel.listAll({ inboxToken: inbox.token })).toHaveLength(0)
  })

  it('deleteByIds removes only the given captures, scoped to the inbox', async () => {
    const db = freshDb()
    const { inbox, captured } = await seed(db, { captures: 4 })
    const readModel = new SqliteRequestListReadModel(db)
    const all = await readModel.listAll({ inboxToken: inbox.token })
    const ids = [all[0].id, all[1].id]
    const deleted = await captured.deleteByIds(inbox.token, ids)
    expect(deleted).toBe(2)
    const remaining = await readModel.listAll({ inboxToken: inbox.token })
    expect(remaining).toHaveLength(2)
    expect(remaining.map(r => r.id).sort()).toEqual([all[2].id, all[3].id].sort())
  })

  it('deleteByIds ignores ids from other inboxes', async () => {
    const db = freshDb()
    const a = await seed(db, { captures: 2 })
    const b = await seed(db, { captures: 2 })
    const readModel = new SqliteRequestListReadModel(db)
    const bIds = (await readModel.listAll({ inboxToken: b.inbox.token })).map(r => r.id)
    // Try to delete inbox B's captures via inbox A's token — must be a no-op.
    const deleted = await a.captured.deleteByIds(a.inbox.token, bIds)
    expect(deleted).toBe(0)
    expect(await readModel.listAll({ inboxToken: b.inbox.token })).toHaveLength(2)
  })

  it('resetCaptureCount zeroes the lifetime cap and rate window', async () => {
    const db = freshDb()
    const { inbox, inboxes } = await seed(db, { captures: 2 })
    // Simulate a filled inbox.
    db.query('UPDATE inboxes SET capture_count = 1000, rate_window_count = 42 WHERE token = ?').run(inbox.token)
    await inboxes.resetCaptureCount(inbox.token)
    const after = await inboxes.findByToken(inbox.token)
    expect(after.captureCount).toBe(0)
    expect(after.rateWindow.count).toBe(0)
    expect(after.rateWindow.startedAt).toBeNull()
  })
})
