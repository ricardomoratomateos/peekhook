/**
 * SearchField value object.
 *
 * The search API accepts a single string param `field` that is one of:
 *   - 'path'                     → regex against request.path
 *   - 'body'                     → regex against request.body (raw text)
 *   - 'header:<header-name>'     → regex against headers[<header-name>]
 *
 * Parsing is centralized here so the use case never deals with the
 * `header:` prefix; the repository receives a structured `{kind, name}`
 * shape that maps one-to-one to the Mongo filter expression.
 */

const HEADER_PREFIX = 'header:'

export class SearchField {
  /**
   * @param {{ kind: 'path' | 'body' | 'header', name: string | null }} parts
   */
  constructor(parts) {
    this.kind = parts.kind
    this.name = parts.name
  }

  /**
   * Parse the `field` query parameter.
   *
   * @param {unknown} raw
   * @returns {SearchField}
   * @throws {Error} on invalid input (non-string, unknown shape, empty header name)
   */
  static parse(raw) {
    if (typeof raw !== 'string' || raw.length === 0) {
      throw new Error('field must be one of "path", "body", or "header:<name>"')
    }
    if (raw === 'path') return new SearchField({ kind: 'path', name: null })
    if (raw === 'body') return new SearchField({ kind: 'body', name: null })
    if (raw.startsWith(HEADER_PREFIX)) {
      const name = raw.slice(HEADER_PREFIX.length)
      if (name.length === 0) {
        throw new Error('field "header:" requires a header name')
      }
      return new SearchField({ kind: 'header', name })
    }
    throw new Error('field must be one of "path", "body", or "header:<name>"')
  }
}
