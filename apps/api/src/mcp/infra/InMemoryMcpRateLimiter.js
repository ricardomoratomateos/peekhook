import { McpRateLimiter } from '../domain/McpRateLimiter.js'

const WINDOW_MS = 60 * 1000
const MAX_REQS  = 10
const BUCKET_TTL_MS = 24 * 60 * 60 * 1000

/**
 * InMemoryMcpRateLimiter — process-local sliding window per token
 * hash. Per-call budget is 10 requests / 60s; the retry-after hint
 * is computed from the oldest request inside the window so callers
 * know exactly when a slot frees up.
 *
 * Bucket shape: `requests: number[]` of timestamps (ms). On each
 * access, prune to the window then either append (allowed) or
 * compute retry-after from the oldest in-window timestamp.
 *
 * Stale buckets (no access for `ttlMs`) are swept on access so a
 * long-running process does not accumulate entries for tokens that
 * stopped showing up.
 *
 * @param {{
 *   now?:         () => number,
 *   windowMs?:    number,
 *   maxRequests?: number,
 *   ttlMs?:       number,
 * }} [opts]
 */
export class InMemoryMcpRateLimiter extends McpRateLimiter {
  constructor({
    now,
    windowMs    = WINDOW_MS,
    maxRequests = MAX_REQS,
    ttlMs       = BUCKET_TTL_MS,
  } = {}) {
    super()
    this.now         = now ?? (() => Date.now())
    this.windowMs    = windowMs
    this.maxRequests = maxRequests
    this.ttlMs       = ttlMs
    this.buckets     = new Map()
  }

  async tryConsume({ tokenHash }) {
    if (typeof tokenHash !== 'string' || tokenHash.length === 0) {
      throw new Error('tokenHash required')
    }

    const now = this.now()
    this.#sweepStale(now)

    let bucket = this.buckets.get(tokenHash)
    if (!bucket) {
      bucket = { requests: [], lastSeenMs: now }
      this.buckets.set(tokenHash, bucket)
    }
    bucket.lastSeenMs = now

    const cutoff = now - this.windowMs
    bucket.requests = bucket.requests.filter((t) => t > cutoff)

    if (bucket.requests.length >= this.maxRequests) {
      const oldest     = bucket.requests[0]
      const retryAfterMs = (oldest + this.windowMs) - now
      const retryAfterSec = Math.max(1, Math.ceil(Math.max(0, retryAfterMs) / 1000))
      return { allowed: false, retryAfterSec }
    }

    bucket.requests.push(now)
    return { allowed: true }
  }

  #sweepStale(now) {
    for (const [token, bucket] of this.buckets) {
      if (now - bucket.lastSeenMs > this.ttlMs) this.buckets.delete(token)
    }
  }
}