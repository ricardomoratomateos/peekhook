import { SearchField } from '../domain/SearchField.js'

const REGEX_MAX_LENGTH    = 256
const REGEX_LIMIT_DEFAULT = 50
const REGEX_LIMIT_MAX     = 200

/**
 * SearchEvents — server-side regex search over an inbox's captured requests.
 *
 * Validates the regex at the boundary (caller-facing public API) so the
 * repository never sees an empty or oversize pattern. Empty regex is a
 * silent no-op (returns `[]`) rather than a 400: a missing query string
 * for an empty search is a UI shortcut, not a user error. Anything else
 * invalid (oversize, non-string, non-compiling, unknown field) throws
 * and the HTTP adapter maps it to a 400.
 *
 * Default + cap on the limit live here so the use case stays
 * transport-agnostic; the repository also defends in depth.
 *
 * @param {{
 *   repo: import('../domain/SearchEventsRepository.js').SearchEventsRepository,
 * }} deps
 */
export class SearchEvents {
  constructor({ repo }) {
    this.repo = repo
  }

  /**
   * @param {{
   *   inboxToken: string,
   *   regex:      unknown,           // string from HTTP query; non-string → throws.
   *   field:      unknown,           // SearchField.parse handle.
   *   limit?:     unknown,
   *   before?:    unknown,
   * }} query
   * @returns {Promise<object[]>} CapturedRequest DTOs, newest first.
   */
  async execute({ inboxToken, regex, field, limit, before }) {
    if (typeof regex !== 'string') {
      throw new Error('regex must be a non-empty string')
    }
    if (regex.trim().length === 0) {
      return []
    }
    if (regex.length > REGEX_MAX_LENGTH) {
      throw new Error(`regex exceeds ${REGEX_MAX_LENGTH} chars`)
    }
    try {
      new RegExp(regex)
    } catch (_err) {
      throw new Error('regex is not a valid regular expression')
    }

    const parsedField = SearchField.parse(field)

    const normalisedLimit = Math.min(
      Number(limit) || REGEX_LIMIT_DEFAULT,
      REGEX_LIMIT_MAX,
    )

    return this.repo.search({
      inboxToken,
      regex,
      field:      parsedField,
      limit:      normalisedLimit,
      before,
    })
  }
}
