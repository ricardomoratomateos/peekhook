/**
 * ListRequests — paginated list of captured requests for an inbox (query side).
 *
 * Deliberately thin: delegates entirely to the read model. Defaults and
 * caps on limit live in the Mongo read model so the use case stays
 * port-agnostic.
 *
 * @param {{ requests: import('../domain/RequestListReadModel.js').RequestListReadModel }} deps
 */
export class ListRequests {
  constructor({ requests }) {
    this.requests = requests
  }

  /**
   * @param {{ inboxToken: string, limit?: number, before?: string }} query
   * @returns {Promise<object[]>} CapturedRequest DTOs, newest first
   */
  execute({ inboxToken, limit, before }) {
    return this.requests.list({ inboxToken, limit, before })
  }
}
