/**
 * Port: gates MCP tool calls per token hash.
 *
 * MVP scope — a single in-memory sliding window per SHA-256 hash,
 * 10 requests / 60 seconds, with a TTL prune for stale buckets so
 * long-running processes do not accumulate entries. State is per
 * process: restarting the api resets every limit. Acceptable for
 * the single-instance MVP deploy; multi-replica deployments will
 * need a coordinated backend (redis, mongo). Documented as a known
 * limitation.
 *
 * Implementations live under `mcp/infra/`. Tests provide an inline
 * fake.
 */
export class McpRateLimiter {
  /**
   * @param {{ tokenHash: string }} cmd
   *   SHA-256 hex of the bearer token. The plaintext never reaches
   *   this port — only the hash that already authenticated the
   *   request upstream.
   * @returns {Promise<{ allowed: boolean, retryAfterSec?: number }>}
   */
  async tryConsume(_cmd) {
    throw new Error('McpRateLimiter.tryConsume not implemented')
  }
}