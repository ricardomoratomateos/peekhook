/**
 * Port: regex search over captured requests for an inbox.
 *
 * Implemented by `MongoRegexSearchRepository` (infra) and by in-memory
 * fakes in tests. The use case composes this with `SearchField.parse()`
 * so the repository always sees a structured field, never the raw
 * `header:foo` string from the API.
 *
 * Returned documents are sorted newest first (ObjectId desc), matching
 * the listing endpoint so the Inspector UI can swap reads between
 * `list()` and `search()` without reordering on the client.
 */
export class SearchEventsRepository {
  /**
   * @param {{
   *   inboxToken: string,
   *   regex:      string,                 // Already-validated regex literal.
   *   field:      import('./SearchField.js').SearchField,
   *   limit?:     number,                 // Hard-capped at the infra layer.
   *   before?:    string,                 // ObjectId cursor; older-than cursor.
   * }} query
   * @returns {Promise<object[]>} CapturedRequest DTOs, newest first.
   */
  async search({ inboxToken, regex, field, limit, before }) {
    throw new Error('SearchEventsRepository.search not implemented')
  }
}
