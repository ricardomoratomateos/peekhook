import { ReplayRateLimiter } from '../domain/ReplayRateLimiter.js'

const REFILL_INTERVAL_MS = 60 * 1000       // 1 token / minute
const BUCKET_CAPACITY    = 1                // no bursting
const BUCKET_TTL_MS      = 24 * 60 * 60 * 1000 // 24h on-access prune

/**
 * InMemoryReplayRateLimiter — process-local token bucket per inbox
 * token. MVP-only; restarting the api process resets every limit.
 * Outline:
 *
 *   - capacity 1, refill 1 per minute, bucket-cursor pre-allocated
 *     tokens; an unkeyed access creates a full bucket at `now`.
 *   - on each access: lazy-refill by `floor(elapsed/interval)` tokens,
 *     capped at capacity; consume one if available; otherwise
 *     return `retryAfterSec` = ms-until-next-refill rounded up to
 *     whole seconds (≥ 1).
 *   - on each access: prune buckets whose last refill cursor is
 *     older than `ttlMs`. The sweeper is on-access, not background
 *     — the spec says restarting the process resets state, so a
 *     long-running process that accumulates idle entries just
 *     sheds them at the next relevant access.
 *
 * @param {{
 *   now?:               () => number,
 *   refillIntervalMs?:  number,
 *   capacity?:          number,
 *   ttlMs?:             number,
 * }} [opts]
 */
export class InMemoryReplayRateLimiter extends ReplayRateLimiter {
  constructor({ now, refillIntervalMs = REFILL_INTERVAL_MS, capacity = BUCKET_CAPACITY, ttlMs = BUCKET_TTL_MS } = {}) {
    super()
    this.now               = now ?? (() => Date.now())
    this.refillIntervalMs  = refillIntervalMs
    this.capacity          = capacity
    this.ttlMs             = ttlMs
    this.buckets           = new Map()
  }

  async tryConsume({ inboxToken }) {
    if (typeof inboxToken !== 'string' || inboxToken.length === 0) {
      throw new Error('inboxToken required')
    }

    const now = this.now()
    this.#sweepStale(now)

    let bucket = this.buckets.get(inboxToken)
    if (!bucket) {
      bucket = { tokens: this.capacity, lastRefillMs: now }
      this.buckets.set(inboxToken, bucket)
    } else {
      const elapsed = now - bucket.lastRefillMs
      if (elapsed >= this.refillIntervalMs) {
        const refills = Math.floor(elapsed / this.refillIntervalMs)
        bucket.tokens      = Math.min(this.capacity, bucket.tokens + refills)
        bucket.lastRefillMs = bucket.lastRefillMs + refills * this.refillIntervalMs
      }
    }

    if (bucket.tokens >= 1) {
      bucket.tokens -= 1
      return { allowed: true }
    }

    const retryAfterMs = (bucket.lastRefillMs + this.refillIntervalMs) - now
    return {
      allowed:        false,
      retryAfterSec:  Math.max(1, Math.ceil(Math.max(0, retryAfterMs) / 1000)),
    }
  }

  #sweepStale(now) {
    for (const [token, bucket] of this.buckets) {
      if (now - bucket.lastRefillMs > this.ttlMs) this.buckets.delete(token)
    }
  }
}
