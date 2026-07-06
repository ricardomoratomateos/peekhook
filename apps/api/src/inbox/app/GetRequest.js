/**
 * GetRequest — fetch a single captured request by id (query side).
 *
 * Scoped to an inbox token so clients cannot enumerate requests across
 * inboxes by guessing ids.
 *
 * @param {{ requests: import('../domain/RequestListReadModel.js').RequestListReadModel }} deps
 */
export class GetRequest {
  constructor({ requests }) {
    this.requests = requests
  }

  /**
   * @param {{ inboxToken: string, id: string }} query
   * @returns {Promise<object|null>} CapturedRequest DTO, or null
   */
  execute({ inboxToken, id }) {
    return this.requests.findById({ inboxToken, id })
  }
}
