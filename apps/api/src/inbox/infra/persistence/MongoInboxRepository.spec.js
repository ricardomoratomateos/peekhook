import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { startMongo, stopMongo } from '../../../../test/helpers/mongoMemory.js'
import { MongoInboxRepository } from './MongoInboxRepository.js'
import { SandboxInbox, MAX_CAPTURE_COUNT, RATE_LIMIT_WINDOW_MS } from '../../domain/SandboxInbox.js'

/**
 * Integration tests for the atomic capture-slot reservation that
 * backs the v1.1 security limits (ROADMAP items 2 + 7: rate limit +
 * per-inbox capture cap). Talks to mongodb-memory-server so the
 * `findOneAndUpdate` semantics match production.
 */
describe('MongoInboxRepository.tryConsumeCaptureSlot', () => {
  let db
  let repo

  beforeAll(async () => {
    db = await startMongo()
    repo = new MongoInboxRepository(db)
  })

  afterAll(async () => {
    await stopMongo()
  })

  it('returns inbox_not_found when the token does not resolve', async () => {
    const now = new Date()
    const result = await repo.tryConsumeCaptureSlot('no-such-token', now)
    expect(result.ok).toBe(false)
    expect(result.reason).toBe('inbox_not_found')
    expect(result.inbox).toBeNull()
  })

  it('reserves a slot on a fresh inbox and increments captureCount + opens a new window', async () => {
    const inbox = SandboxInbox.create()
    await repo.insert(inbox)
    const now = new Date()

    const result = await repo.tryConsumeCaptureSlot(inbox.token, now)
    expect(result.ok).toBe(true)
    expect(result.inbox.captureCount).toBe(1)
    expect(result.inbox.rateWindow.startedAt).toBeInstanceOf(Date)
    expect(result.inbox.rateWindow.count).toBe(1)
  })

  it('rejects with capacity_exceeded once captureCount === MAX_CAPTURE_COUNT', async () => {
    const inbox = SandboxInbox.create({
      captureCount: MAX_CAPTURE_COUNT - 1,
      rateWindow:   { startedAt: null, count: 0 },
    })
    await repo.insert(inbox)

    const ok = await repo.tryConsumeCaptureSlot(inbox.token, new Date())
    expect(ok.ok).toBe(true)
    expect(ok.inbox.captureCount).toBe(MAX_CAPTURE_COUNT)

    const blocked = await repo.tryConsumeCaptureSlot(inbox.token, new Date())
    expect(blocked.ok).toBe(false)
    expect(blocked.reason).toBe('capacity_exceeded')
  })

  it('rejects with rate_limited when 60 captures already accepted within the window', async () => {
    const inbox = SandboxInbox.create()
    await repo.insert(inbox)
    const t0 = new Date()

    for (let i = 0; i < RATE_LIMIT_WINDOW_MS / 1000 /* 60 */; i++) {
      const r = await repo.tryConsumeCaptureSlot(inbox.token, new Date(t0.getTime() + i * 100))
      expect(r.ok).toBe(true)
      expect(r.inbox.rateWindow.count).toBe(i + 1)
    }

    const blocked = await repo.tryConsumeCaptureSlot(inbox.token, new Date(t0.getTime() + 100))
    expect(blocked.ok).toBe(false)
    expect(blocked.reason).toBe('rate_limited')
    expect(blocked.retryAfterMs).toBeGreaterThan(0)
    expect(blocked.retryAfterMs).toBeLessThanOrEqual(RATE_LIMIT_WINDOW_MS)
  })

  it('starts a fresh window after RATE_LIMIT_WINDOW_MS has elapsed', async () => {
    const inbox = SandboxInbox.create()
    await repo.insert(inbox)
    const t0 = new Date()

    for (let i = 0; i < 60; i++) {
      const r = await repo.tryConsumeCaptureSlot(inbox.token, new Date(t0.getTime() + i * 100))
      expect(r.ok).toBe(true)
    }
    const blocked = await repo.tryConsumeCaptureSlot(inbox.token, new Date(t0.getTime() + 1000))
    expect(blocked.ok).toBe(false)
    expect(blocked.reason).toBe('rate_limited')

    const later = new Date(t0.getTime() + RATE_LIMIT_WINDOW_MS + 1)
    const fresh = await repo.tryConsumeCaptureSlot(inbox.token, later)
    expect(fresh.ok).toBe(true)
    expect(fresh.inbox.rateWindow.count).toBe(1)
    expect(fresh.inbox.rateWindow.startedAt.getTime()).toBe(later.getTime())
  })

  it('keeps counting past the rate window but never past the capacity cap', async () => {
    const inbox = SandboxInbox.create()
    await repo.insert(inbox)
    const t0 = new Date()

    for (let i = 0; i < 70; i++) {
      // 70 captures spaced > RATE_LIMIT_WINDOW_MS apart, so the
      // window resets each time — proving captureCount climbs.
      const t = new Date(t0.getTime() + i * (RATE_LIMIT_WINDOW_MS + 100))
      const r = await repo.tryConsumeCaptureSlot(inbox.token, t)
      expect(r.ok).toBe(true)
    }

    const state = await repo.findByToken(inbox.token)
    expect(state.captureCount).toBe(70)
  })
})
