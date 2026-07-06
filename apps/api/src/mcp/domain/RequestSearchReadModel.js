/**
 * Port: cheap regex search over inbox requests.
 *
 * Implemented by `MongoRequestSearchReadModel` (infra) and in-memory
 * fakes for tests. Kept separate from `RequestListReadModel` because
 * the use case needs `$regex` on raw fields (path, body, headers) —
 * not part of the list/get projection surface.
 */
export class RequestSearchReadModel {
  /**
   * @param {{
   *   inboxToken: string,
   *   regex: string,            // Already-escaped regex literal.
   *   field: 'path' | 'header' | 'body',
   *   headerKey?: string,       // Required when field='header'.
   *   limit?: number,
   * }} query
   * @returns {Promise<object[]>} CapturedRequest DTOs, newest first
   */
  async search({ inboxToken, regex, field, headerKey, limit }) {
    throw new Error('RequestSearchReadModel.search not implemented')
  }
}
