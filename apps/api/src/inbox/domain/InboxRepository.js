/**
 * Port: persists and retrieves SandboxInbox aggregates.
 * Implemented by infra (MongoInboxRepository) and by test fakes.
 */
export class InboxRepository {
  /**
   * @param {string} token
   * @returns {Promise<object|null>} the inbox document, or null if not found
   */
  async findByToken(token) {
    throw new Error('InboxRepository.findByToken not implemented')
  }

  /**
   * @param {import('./SandboxInbox.js').SandboxInbox} inbox
   * @returns {Promise<void>}
   */
  async insert(inbox) {
    throw new Error('InboxRepository.insert not implemented')
  }

  /**
   * Set or clear the configured ingest response for a sandbox inbox.
   * Pass `null` to clear (revert to default acknowledgement).
   *
   * `mockBodySize` is the UTF-8 byte size of the configured body, or
   * `0` when `responseConfig` is `null`. The aggregate carries it as
   * a sibling field (`SandboxInbox.mockBodySize`) so callers don't
   * have to recompute byte length on every read.
   *
   * @param {string} token
   * @param {null | { enabled: boolean, status: number, contentType: string, body: string }} responseConfig
   * @param {number} [mockBodySize=0]
   * @returns {Promise<void>}
   */
  async updateResponseConfig(token, responseConfig, mockBodySize = 0) {
    throw new Error('InboxRepository.updateResponseConfig not implemented')
  }

  /**
   * Set or clear the configured forward target. Pass `null` to clear.
   *
   * @param {string} token
   * @param {null | string} forwardTo  validated http(s) URL or null
   * @returns {Promise<void>}
   */
  async updateForwardTo(token, forwardTo) {
    throw new Error('InboxRepository.updateForwardTo not implemented')
  }

  /**
   * Set or clear the capture allowlist. Pass `null` to clear (capture
   * everything). The value is the already-validated + normalised filter
   * returned by `validateCaptureFilter`.
   *
   * @param {string} token
   * @param {null | object} captureFilter
   * @returns {Promise<void>}
   */
  async updateCaptureFilter(token, captureFilter) {
    throw new Error('InboxRepository.updateCaptureFilter not implemented')
  }

  /**
   * Atomically check both the per-inbox capacity cap and the 60/min
   * sliding-window rate limit, and (if both pass) increment the
   * counters on the inbox document in a single operation.
   *
   * Behaviour:
   *   - Returns { ok: true, inbox } on success (counters incremented).
   *   - Returns { ok: false, inbox: null, reason: 'inbox_not_found' }
   *     if the token does not resolve.
   *   - Returns { ok: false, inbox, reason: 'capacity_exceeded' } if
   *     `captureCount >= MAX_CAPTURE_COUNT` (lifetime cap).
   *   - Returns { ok: false, inbox, reason: 'rate_limited',
   *     retryAfterMs } if 60 requests have been accepted within the
   *     current 60-second window. `retryAfterMs` is the time until
   *     the window's `startedAt + 60s` so callers can surface a
   *     `Retry-After` header.
   *
   * Implementations must perform the increment atomically (e.g. via
   * Mongo's `findOneAndUpdate` with a conditional filter) so two
   * concurrent captures cannot both pass the threshold check.
   *
   * @param {string} token
   * @param {Date}   now
   * @returns {Promise<
   *   | { ok: true,  inbox: object }
   *   | { ok: false, inbox: object | null,
   *       reason: 'inbox_not_found' | 'capacity_exceeded' | 'rate_limited',
   *       retryAfterMs?: number }
   * >}
   */
  async tryConsumeCaptureSlot(token, now) {
    throw new Error('InboxRepository.tryConsumeCaptureSlot not implemented')
  }

  /**
   * Reset the lifetime capture counter and the sliding rate window to
   * zero. Called when the user clears an inbox's captures so the
   * 1,000-cap frees up again on the same token. No-op if the token
   * does not resolve.
   *
   * @param {string} token
   * @returns {Promise<void>}
   */
  async resetCaptureCount(token) {
    throw new Error('InboxRepository.resetCaptureCount not implemented')
  }
}
