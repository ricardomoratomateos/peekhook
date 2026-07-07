/**
 * Port: mints ids and persists CapturedRequest aggregates.
 * The id is allocated up-front so the use case can return it before
 * the aggregate is written.
 */
export class CapturedRequestRepository {
  /** @returns {*} a fresh, store-native request id */
  nextId() {
    throw new Error('CapturedRequestRepository.nextId not implemented')
  }

  /**
   * @param {import('./CapturedRequest.js').CapturedRequest} req
   * @returns {Promise<void>}
   */
  async insert(req) {
    throw new Error('CapturedRequestRepository.insert not implemented')
  }

  /**
   * Attach an upstream response (or error) to a previously-captured
   * request. Used by ingest after a forwardTo attempt resolves.
   *
   * `upstream` is the DTO produced by ForwardRequest:
   *   - on success: { status, headers, body, contentType, durationMs }
   *   - on failure: { error, message, durationMs }
   *
   * @param {string} id
   * @param {object} upstream
   * @returns {Promise<void>}
   */
  async updateUpstreamResponse(id, upstream) {
    throw new Error('CapturedRequestRepository.updateUpstreamResponse not implemented')
  }

  /**
   * Mint a random share id and attach it to the captured request.
   * Idempotent: if the request already has a shareId, return the
   * existing one. Returns the shareId string (32 hex chars).
   *
   * @param {string} id
   * @param {string} inboxToken
   * @returns {Promise<string|null>} shareId, or null when the request
   *   does not exist for the given inbox token.
   */
  async upsertShareId(id, inboxToken) {
    throw new Error('CapturedRequestRepository.upsertShareId not implemented')
  }
}
