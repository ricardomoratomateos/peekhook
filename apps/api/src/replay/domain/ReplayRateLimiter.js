/**
 * Port: gates replay attempts per inbox token.
 *
 * MVP scope — a single shared bucket per inbox, capacity 1, refill
 * 1 per minute, with a 24-hour on-access prune for buckets that
 * haven't been touched. State is per process: restarting the api
 * resets every limit. That's acceptable for the single-instance
 * MVP deploy; multi-replica deployments will need a coordinated
 * backend (redis, mongo). Documented as a known limitation.
 *
 * Implementations live under `replay/infra/`. Tests
 * provide an inline fake.
 */
export class ReplayRateLimiter {
  /**
   * @param {{ inboxToken: string }} cmd
   * @returns {Promise<{ allowed: boolean, retryAfterSec?: number }>}
   */
  async tryConsume(_cmd) {
    throw new Error('ReplayRateLimiter.tryConsume not implemented')
  }
}
