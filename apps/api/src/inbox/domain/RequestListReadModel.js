/**
 * Port: read side for sandbox requests (CQRS-lite).
 * Queries bypass the domain aggregate and return DTOs directly.
 * Implemented by MongoRequestListReadModel and in-memory fakes for tests.
 */
export class RequestListReadModel {
  /**
   * @param {{ inboxToken: string, limit?: number, before?: string }} query
   * @returns {Promise<object[]>} CapturedRequest DTOs, newest first
   */
  async list({ inboxToken, limit, before }) {
    throw new Error('RequestListReadModel.list not implemented')
  }

  /**
   * @param {{ inboxToken: string, id: string }} query
   * @returns {Promise<object|null>} CapturedRequest DTO, or null if not found
   */
  async findById({ inboxToken, id }) {
    throw new Error('RequestListReadModel.findById not implemented')
  }

  /**
   * Public share lookup by the random shareId minted at share time.
   * Scoped to inboxToken (passed as `?token=` on the public URL) so a
   * leaked shareId cannot enumerate other inboxes' captures.
   *
   * @param {{ inboxToken: string, shareId: string }} query
   * @returns {Promise<object|null>} CapturedRequest DTO, or null if not found
   */
  async findByShareId({ inboxToken, shareId }) {
    throw new Error('RequestListReadModel.findByShareId not implemented')
  }

  /**
   * Cursor advance for the SSE stream. Returns DTOs whose id is
   * strictly greater than `afterId`, in ascending order, up to `limit`.
   * `afterId === null` means "starting from the beginning" (i.e. no
   * id filter) — used when the SSE handler initialises on a fresh
   * connection and wants every unread event.
   *
   * Implementations must use the store-native id ordering (ObjectId
   * for Mongo, 24-hex string for SQLite) so the cursor matches the
   * chronological order of inserts.
   *
   * @param {{ inboxToken: string, afterId: string|null, limit?: number }} query
   * @returns {Promise<object[]>} CapturedRequest DTOs, oldest first
   */
  async listAfter({ inboxToken, afterId, limit }) {
    throw new Error('RequestListReadModel.listAfter not implemented')
  }

  /**
   * Most recent DTO for the inbox, or null when the inbox has no
   * captures. Used by the SSE handler as the "starting point" for
   * a fresh stream: it primes `lastId` with the latest known id so
   * the next `listAfter` only emits new events.
   *
   * @param {string} inboxToken
   * @returns {Promise<object|null>}
   */
  async findLatest(inboxToken) {
    throw new Error('RequestListReadModel.findLatest not implemented')
  }
}
