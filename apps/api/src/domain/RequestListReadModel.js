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
}
