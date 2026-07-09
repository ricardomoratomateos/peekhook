import { RequestListReadModel } from '../../domain/RequestListReadModel.js'

const DEFAULT_LIMIT = 50
const MAX_LIMIT = 200
const ID_REGEX = /^[0-9a-f]{24}$/
const SHARE_ID_REGEX = /^[0-9a-f]{32}$/

/** Hydrate a Snake-case row into the public CapturedRequest DTO. */
function toDto(row) {
  let query = null
  let headers = null
  let upstreamResponse = null
  try { query = row.query ? JSON.parse(row.query) : null } catch { query = null }
  try { headers = row.headers ? JSON.parse(row.headers) : null } catch { headers = null }
  try {
    upstreamResponse = row.upstream_response ? JSON.parse(row.upstream_response) : null
  } catch { upstreamResponse = null }

  return {
    id:               row.id,
    method:           row.method,
    path:             row.path,
    query,
    headers,
    body:             row.body,
    contentType:      row.content_type,
    size:             row.size,
    ip:               row.ip,
    createdAt:        new Date(row.created_at),
    upstreamResponse,
    shareId:          row.share_id ?? null,
  }
}

function clampLimit(limit) {
  const n = Number(limit)
  return Math.min(Number.isFinite(n) && n > 0 ? n : DEFAULT_LIMIT, MAX_LIMIT)
}

/**
 * SQLite read model for paginated inbox request listing.
 * Reads `requests` directly; no aggregate is hydrated. Cursor
 * pagination uses the 24-hex id (time-prefixed so lex order matches
 * chronological order) — same semantics as the Mongo ObjectId cursor.
 */
export class SqliteRequestListReadModel extends RequestListReadModel {
  constructor(db) {
    super()
    this.db = db
    this.stmt = {
      listBefore: db.prepare(`
        SELECT * FROM requests
         WHERE inbox_token = ? AND id < ?
         ORDER BY id DESC
         LIMIT ?
      `),
      listNoBefore: db.prepare(`
        SELECT * FROM requests
         WHERE inbox_token = ?
         ORDER BY id DESC
         LIMIT ?
      `),
      findById: db.prepare(
        'SELECT * FROM requests WHERE id = ? AND inbox_token = ?',
      ),
      findByShareId: db.prepare(
        'SELECT * FROM requests WHERE inbox_token = ? AND share_id = ?',
      ),
      listAfter: db.prepare(`
        SELECT * FROM requests
         WHERE inbox_token = ? AND id > ?
         ORDER BY id ASC
         LIMIT ?
      `),
      listAfterNoAfter: db.prepare(`
        SELECT * FROM requests
         WHERE inbox_token = ?
         ORDER BY id ASC
         LIMIT ?
      `),
      findLatest: db.prepare(
        'SELECT * FROM requests WHERE inbox_token = ? ORDER BY id DESC LIMIT 1',
      ),
      listAll: db.prepare(
        'SELECT * FROM requests WHERE inbox_token = ? ORDER BY id DESC LIMIT ?',
      ),
    }
  }

  async list({ inboxToken, limit = DEFAULT_LIMIT, before }) {
    const cap = clampLimit(limit)
    let rows
    if (typeof before === 'string' && ID_REGEX.test(before)) {
      rows = this.stmt.listBefore.all(inboxToken, before, cap)
    } else {
      rows = this.stmt.listNoBefore.all(inboxToken, cap)
    }
    return rows.map(toDto)
  }

  async findById({ inboxToken, id }) {
    if (typeof id !== 'string' || !ID_REGEX.test(id)) return null
    const row = this.stmt.findById.get(id, inboxToken)
    return row ? toDto(row) : null
  }

  async findByShareId({ inboxToken, shareId }) {
    if (typeof shareId !== 'string' || !SHARE_ID_REGEX.test(shareId)) return null
    const row = this.stmt.findByShareId.get(inboxToken, shareId)
    return row ? toDto(row) : null
  }

  /**
   * Cursor advance for the SSE poller. The 24-hex id is generated
   * by `SqliteCapturedRequestRepository.nextId()` as
   * `Mongo.ObjectId().toString()` (24 lowercase hex chars), so
   * lexicographic `id > ?` matches Mongo's `ObjectId > ObjectId`
   * ordering — both formats put the 4-byte timestamp as the high
   * bytes, then the per-process counter, then the random suffix.
   *
   * `afterId === null` means "no lower bound" — the poller wants
   * the oldest unread event from the start of the stream. Limit
   * defaults to 20 (SSE poll batch) and is hard-capped at 200.
   */
  async listAfter({ inboxToken, afterId, limit = 20 }) {
    const cap = Math.min(Number(limit) || 20, 200)
    let rows
    if (typeof afterId === 'string' && ID_REGEX.test(afterId)) {
      rows = this.stmt.listAfter.all(inboxToken, afterId, cap)
    } else {
      rows = this.stmt.listAfterNoAfter.all(inboxToken, cap)
    }
    return rows.map(toDto)
  }

  /**
   * Most recent capture for the inbox, projected to the DTO shape.
   * Returns null when the inbox has no captures. Used by the SSE
   * handler to seed `lastId` on connection open.
   */
  async findLatest(inboxToken) {
    const row = this.stmt.findLatest.get(inboxToken)
    return row ? toDto(row) : null
  }

  async listAll({ inboxToken, limit = 1000 }) {
    const cap = Math.min(Number(limit) || 1000, 1000)
    const rows = this.stmt.listAll.all(inboxToken, cap)
    return rows.map(toDto)
  }
}

/**
 * The `requests` schema is owned by SqliteCapturedRequestRepository.migrate.
 * Exported here so app bootstrap can call either repository's migrate
 * independently and still end up with a valid schema when only the read
 * model is wired in (e.g. in tests).
 */
export function migrate(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS requests (
      id TEXT PRIMARY KEY,
      inbox_token TEXT NOT NULL,
      method TEXT NOT NULL,
      path TEXT NOT NULL,
      query TEXT,
      headers TEXT,
      body TEXT,
      content_type TEXT,
      size INTEGER NOT NULL DEFAULT 0,
      ip TEXT,
      created_at INTEGER NOT NULL,
      upstream_response TEXT,
      share_id TEXT,
      expires_at INTEGER NOT NULL
    );
  `)
}
