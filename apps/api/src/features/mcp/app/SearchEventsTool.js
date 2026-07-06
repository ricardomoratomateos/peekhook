/**
 * search_events tool handler.
 *
 * Validates inputs and delegates the actual `$regex` query to a
 * `RequestSearchReadModel` port implementation. The regex is escaped
 * to a literal substring at this boundary so callers (AI agents) can
 * pass plain text without breaking the Mongo query.
 *
 * Limit 50, hard-capped — see `MongoRequestSearchReadModel`.
 */
export class SearchEventsTool {
  constructor({ readModel }) {
    this.readModel = readModel
  }

  /**
   * @param {{
   *   inbox_token: string,
   *   regex: string,
   *   field?: 'path' | 'header' | 'body',
   *   header_key?: string,
   *   limit?: number,
   * }} args
   * @returns {Promise<{ events: object[] }>}
   *   Wrapper shape — `{events: [...]}` keeps the JSON-RPC response
   *   object-shaped so MCP clients can introspect named fields.
   */
  async execute({ inbox_token, regex, field = 'path', header_key, limit }) {
    if (typeof regex !== 'string' || regex.length === 0) {
      throw new Error('regex must be a non-empty string')
    }
    if (field === 'header' && (typeof header_key !== 'string' || header_key.length === 0)) {
      throw new Error('header_key required when field is "header"')
    }
    const safe = escapeRegex(regex)
    const events = await this.readModel.search({
      inboxToken: inbox_token,
      regex:      safe,
      field,
      headerKey:  header_key,
      limit,
    })
    return { events }
  }
}

function escapeRegex(raw) {
  return raw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
