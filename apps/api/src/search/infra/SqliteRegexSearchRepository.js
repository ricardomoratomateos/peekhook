import { SearchEventsRepository } from '../domain/SearchEventsRepository.js'

const DEFAULT_LIMIT = 50
const MAX_LIMIT     = 200
const FETCH_CAP     = 1000

/**
 * Projects a `requests` row to the public CapturedRequest DTO.
 * Mirrors `MongoRequestListReadModel.toDto` (and `MongoRegexSearchRepository.toDto`)
 * exactly so the Inspector UI sees the same shape regardless of whether the
 * read came from `list()` or `search()`. `headers`/`query` JSON is decoded
 * back to objects, persistence-only fields (`inboxToken`, `expiresAt`) are
 * stripped.
 */
function toDto(row) {
  return {
    id:               row.id,
    method:           row.method,
    path:             row.path,
    query:            row.query    ? JSON.parse(row.query)    : {},
    headers:          row.headers  ? JSON.parse(row.headers)  : {},
    body:             row.body,
    contentType:      row.contentType,
    size:             row.size,
    ip:               row.ip,
    createdAt:        row.createdAt,
    upstreamResponse: row.upstreamResponse ?? null,
    shareId:          row.shareId ?? null,
  }
}

/**
 * Extract the field value to test against the regex for a given request row.
 * Mirrors Mongo's `buildFilter`: only `path`, `body`, and `header:<name>`
 * are supported; other kinds throw — keeping the two adapters
 * behaviorally identical so the use case doesn't need to know which
 * adapter it has.
 */
function extractValue(row, field) {
  switch (field.kind) {
    case 'path':
      return row.path ?? ''
    case 'body':
      return row.body ?? ''
    case 'header': {
      if (!row.headers) return ''
      const headers = JSON.parse(row.headers)
      return headers[field.name] ?? ''
    }
    default:
      throw new Error(`unsupported search field kind: ${field.kind}`)
  }
}

/**
 * SQLite-backed SearchEventsRepository.
 *
 * Reads the `requests` table, then filters in JavaScript via `RegExp.test()`.
 * SQLite has no native regex operator; fetching up to FETCH_CAP rows per
 * inbox and filtering client-side stays correct because per-inbox cardinality
 * is bounded by the 7-day TTL + ~thousand rows/day worst-case.
 *
 * Cursor pagination uses the 24-char hex ObjectId string, compared
 * lexicographically. Because ObjectIds are 12-byte big-endian, a same-length
 * lexicographic comparison yields the same ordering as Mongo's `_id < oid`,
 * so the cursor semantics match the Mongo adapter exactly.
 */
export class SqliteRegexSearchRepository extends SearchEventsRepository {
  constructor(db) {
    super()
    this.db = db
  }

  async search({ inboxToken, regex, field, limit = DEFAULT_LIMIT, before }) {
    const re = new RegExp(regex)

    const where  = ['inbox_token = ?']
    const params = [inboxToken]
    if (before && /^[0-9a-f]{24}$/.test(before)) {
      where.push('id < ?')
      params.push(before)
    }

    const rows = this.db.query(
      `SELECT * FROM requests
       WHERE ${where.join(' AND ')}
       ORDER BY id DESC
       LIMIT ?`,
    ).all(...params, FETCH_CAP)

    const filtered = rows.filter(row => re.test(extractValue(row, field)))

    return filtered
      .slice(0, Math.min(Number(limit) || DEFAULT_LIMIT, MAX_LIMIT))
      .map(toDto)
  }
}

/**
 * No-op: the `requests` table is created by the request repository's
 * migrate. Kept for symmetry with the Mongo `migrate(db)` entry point
 * so the composition root can call all infra migrates uniformly.
 */
export function migrate(_db) {}