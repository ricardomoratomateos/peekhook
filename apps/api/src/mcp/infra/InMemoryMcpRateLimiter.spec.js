import { describe, it, expect, beforeEach } from 'vitest'
import { InMemoryMcpRateLimiter } from './InMemoryMcpRateLimiter.js'

describe('InMemoryMcpRateLimiter', () => {
  let nowMs
  let clock

  beforeEach(() => {
    nowMs = 0
    clock = () => nowMs
  })

  it('allows the first call within a window', async () => {
    const limiter = new InMemoryMcpRateLimiter({ now: clock })
    const r = await limiter.tryConsume({ tokenHash: 'hash_a' })
    expect(r.allowed).toBe(true)
    expect(r.retryAfterSec).toBeUndefined()
  })

  it('allows up to 10 calls in 60s, then rejects the 11th', async () => {
    const limiter = new InMemoryMcpRateLimiter({ now: clock })
    for (let i = 0; i < 10; i++) {
      nowMs = i * 1000
      const r = await limiter.tryConsume({ tokenHash: 'hash_a' })
      expect(r.allowed).toBe(true)
    }
    nowMs = 10_000
    const blocked = await limiter.tryConsume({ tokenHash: 'hash_a' })
    expect(blocked.allowed).toBe(false)
    expect(blocked.retryAfterSec).toBeGreaterThan(0)
    expect(blocked.retryAfterSec).toBeLessThanOrEqual(60)
  })

  it('reports retry-after as the time until the oldest in-window request expires', async () => {
    const limiter = new InMemoryMcpRateLimiter({ now: clock, windowMs: 60_000, maxRequests: 10 })
    // Fill 10 slots across 0..9 seconds.
    for (let i = 0; i < 10; i++) {
      nowMs = i * 1000
      await limiter.tryConsume({ tokenHash: 'hash_a' })
    }
    // Oldest is at t=0; we are at t=20_000. Retry-after = 60 - 20 = 40s.
    nowMs = 20_000
    const blocked = await limiter.tryConsume({ tokenHash: 'hash_a' })
    expect(blocked.allowed).toBe(false)
    expect(blocked.retryAfterSec).toBe(40)
  })

  it('refills slots as the window slides', async () => {
    const limiter = new InMemoryMcpRateLimiter({ now: clock, windowMs: 60_000, maxRequests: 10 })
    for (let i = 0; i < 10; i++) {
      nowMs = i * 1000
      await limiter.tryConsume({ tokenHash: 'hash_a' })
    }
    // Jump past the window — all 10 should now be out-of-window.
    nowMs = 70_000
    const r = await limiter.tryConsume({ tokenHash: 'hash_a' })
    expect(r.allowed).toBe(true)
  })

  it('keeps separate buckets per token hash', async () => {
    const limiter = new InMemoryMcpRateLimiter({ now: clock })
    for (let i = 0; i < 10; i++) {
      nowMs = i * 1000
      expect((await limiter.tryConsume({ tokenHash: 'hash_a' })).allowed).toBe(true)
    }
    // hash_b has its own fresh budget.
    expect((await limiter.tryConsume({ tokenHash: 'hash_b' })).allowed).toBe(true)
    // hash_a is still exhausted.
    expect((await limiter.tryConsume({ tokenHash: 'hash_a' })).allowed).toBe(false)
  })

  it('prunes buckets that have not been touched for longer than the TTL', async () => {
    const limiter = new InMemoryMcpRateLimiter({ now: clock, ttlMs: 60_000 })
    await limiter.tryConsume({ tokenHash: 'hash_a' })

    nowMs = 120_000
    const r = await limiter.tryConsume({ tokenHash: 'hash_a' })
    expect(r.allowed).toBe(true)
    expect(limiter.buckets.size).toBe(1)
  })

  it('throws on a missing tokenHash', async () => {
    const limiter = new InMemoryMcpRateLimiter({ now: clock })
    await expect(limiter.tryConsume({ tokenHash: '' })).rejects.toThrow(/tokenHash/)
  })
})