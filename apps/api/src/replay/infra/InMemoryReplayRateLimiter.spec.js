import { describe, it, expect, beforeEach } from 'vitest'
import { InMemoryReplayRateLimiter } from './InMemoryReplayRateLimiter.js'

describe('InMemoryReplayRateLimiter', () => {
  let nowMs
  let clock

  beforeEach(() => {
    nowMs = 0
    clock = () => nowMs
  })

  it('allows the first call within a minute', async () => {
    const limiter = new InMemoryReplayRateLimiter({ now: clock })
    const r = await limiter.tryConsume({ inboxToken: 'tok' })
    expect(r.allowed).toBe(true)
    expect(r.retryAfterSec).toBeUndefined()
  })

  it('denies the second call within a minute and reports a positive retryAfterSec', async () => {
    const limiter = new InMemoryReplayRateLimiter({ now: clock })
    await limiter.tryConsume({ inboxToken: 'tok' })

    nowMs = 30_000
    const r = await limiter.tryConsume({ inboxToken: 'tok' })
    expect(r.allowed).toBe(false)
    expect(r.retryAfterSec).toBeGreaterThan(0)
    expect(r.retryAfterSec).toBeLessThanOrEqual(30)
  })

  it('allows again once 60s have elapsed', async () => {
    const limiter = new InMemoryReplayRateLimiter({ now: clock })
    await limiter.tryConsume({ inboxToken: 'tok' })

    nowMs = 60_000
    const r = await limiter.tryConsume({ inboxToken: 'tok' })
    expect(r.allowed).toBe(true)
  })

  it('keeps separate buckets per inboxToken', async () => {
    const limiter = new InMemoryReplayRateLimiter({ now: clock })
    expect((await limiter.tryConsume({ inboxToken: 'a' })).allowed).toBe(true)
    expect((await limiter.tryConsume({ inboxToken: 'b' })).allowed).toBe(true)

    nowMs = 5_000
    expect((await limiter.tryConsume({ inboxToken: 'a' })).allowed).toBe(false)
    expect((await limiter.tryConsume({ inboxToken: 'b' })).allowed).toBe(false)
  })

  it('prunes buckets that have not been touched for longer than the TTL', async () => {
    const limiter = new InMemoryReplayRateLimiter({ now: clock, ttlMs: 60_000 })
    await limiter.tryConsume({ inboxToken: 'tok' })

    nowMs = 120_000
    // Accessing after the TTL first sweeps the stale bucket, then
    // starts a fresh full bucket.
    const r = await limiter.tryConsume({ inboxToken: 'tok' })
    expect(r.allowed).toBe(true)
    expect(limiter.buckets.size).toBe(1)
    expect(limiter.buckets.get('tok').tokens).toBe(0)
  })

  it('throws on a missing inboxToken', async () => {
    const limiter = new InMemoryReplayRateLimiter({ now: clock })
    await expect(limiter.tryConsume({ inboxToken: '' })).rejects.toThrow(/inboxToken/)
  })
})
