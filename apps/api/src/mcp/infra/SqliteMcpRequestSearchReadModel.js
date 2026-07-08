import { RequestSearchReadModel } from '../domain/RequestSearchReadModel.js'

const DEFAULT_LIMIT = 50
const MAX_LIMIT     = 50
const FETCH_CAP     = 1000

/**
 * Hydrate a snake_case `requests` row into the public CapturedRequest
 * DTO. Mirrors `MongoRequestSearchReadModel.toDto` and
 * `SqliteRequestListReadModel.toDto` exactly so all three adapters are
 * interchangeable for tool consumers: ids are strings, headers/query
 * JSON is decoded, created_at is a Date.
 */
function toDto(row) {
  let query = null
  let headers = null
  try { query   = row.query   ? JSON.parse(row.query)   : null } catch { query   = null }
  try { headers = row.headers ? JSON.parse(row.headers) : null } catch { headers = null }
  return {
    id:          row.id,
    method:      row.method,
    path:        row.path,
    query,
    headers,
    body:        row.body,
    contentType: row.content_type ?? row.contentType ?? null,
    size:        row.size,
    ip:          row.ip,
    createdAt:   row.created_at instanceof Date ? row.created_at : new Date(row.created_at),
  }
}

/**
 * SQLite-backed RequestSearchReadModel.
 *
 * Reads `requests` for an inbox (bounded by `FETCH_CAP` — a 7-day TTL
 * inbox generates a few hundred events worst-case) and filters in JS
 * with `RegExp.test()`. SQLite has no native regex operator; this
 * matches the pattern in `SqliteRegexSearchRepository` (search domain).
 *
 * Supported `field` values mirror the Mongo adapter exactly so the
 * use case (`SearchEventsTool`) stays storage-agnostic:
 *   - `path`   — case-insensitive match against `requests.path`
 *   - `body`   — case-insensitive match against `requests.body`
 *   - `header` — case-insensitive match against
 *                `requests.headers[<headerKey>]` (case-insensitive
 *                lookup of the header name).
 *
 * Results are sorted by id (which encodes time-prefixed ObjectId
 * semantics) descending and capped at `MAX_LIMIT` (50).
 */
export class SqliteMcpRequestSearchReadModel extends RequestSearchReadModel {
  /**
   * @param {import('bun:sqlite').Database} db
   */
  constructor(db) {
    super()
    this.db = db
  }

  async search({ inboxToken, regex, field, headerKey, limit = DEFAULT_LIMIT }) {
    if (typeof inboxToken !== 'string' || inboxToken.length === 0) return []
    if (typeof regex !== 'string' || regex.length === 0) return []

    let re
    try {
      re = new RegExp(regex, 'i')
    } catch (_err) {
      return []
    }

    const cap = Math.min(Math.max(1, Number(limit) || DEFAULT_LIMIT), MAX_LIMIT)

    const rows = this.db
      .query(`
        SELECT * FROM requests
         WHERE inbox_token = ?
         ORDER BY id DESC
         LIMIT ?
      `)
      .all(inboxToken, FETCH_CAP)

    const matches = rows.filter((row) => matchField(row, field, headerKey, re))
    return matches.slice(0, cap).map(toDto)
  }
}

function matchField(row, field, headerKey, re) {
  if (field === 'path') {
    return re.test(typeof row.path === 'string' ? row.path : '')
  }
  if (field === 'body') {
    return re.test(typeof row.body === 'string' ? row.body : '')
  }
  if (field === 'header') {
    if (typeof headerKey !== 'string' || headerKey.length === 0) return false
    if (typeof row.headers !== 'string' || row.headers.length === 0) return false
    let headers
    try { headers = JSON.parse(row.headers) } catch { return false }
    if (!headers || typeof headers !== 'object') return false
    const lowered = headerKey.toLowerCase()
    for (const key of Object.keys(headers)) {
      if (key.toLowerCase() === lowered) {
        return re.test(typeof headers[key] === 'string' ? headers[key] : String(headers[key] ?? ''))
      }
    }
    return false
  }
  return false
}
