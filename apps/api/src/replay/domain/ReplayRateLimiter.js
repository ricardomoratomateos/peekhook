/**
 * Port: gates replay attempts per (inbox token, client ip) tuple.
 *
 * v1.1 expanded the per-inbox bucket into a per-(token, ip) bucket:
 * the same inbox can be replayed once per minute PER source IP, so a
 * developer and a CI runner on the same inbox don't trip each other.
 *
 * Implementation notes:
 *   - Two independent buckets are consulted: the token-level bucket
 *     (1/min for the inbox as a whole) and the (token, ip)-level
 *     bucket (1/min for that source). Either denial blocks the
 *     replay; the longer retry-after wins on the response.
 *   - Capacity 1, refill 1 per minute, on-access 24h prune.
 *   - State is per process: restarting the api resets every limit.
 *     Acceptable for the single-instance MVP deploy; multi-replica
 *     deployments will need a coordinated backend (redis, mongo).
 *
 * Implementations live under `replay/infra/`. Tests provide an
 * inline fake.
 */
export class ReplayRateLimiter {
  /**
   * @param {{ inboxToken: string, ip?: string }} cmd
   * @returns {Promise<{ allowed: boolean, retryAfterSec?: number }>}
   */
  async tryConsume(_cmd) {
    throw new Error('ReplayRateLimiter.tryConsume not implemented')
  }
}
