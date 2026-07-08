import crypto from 'node:crypto'
import { CapturedRequestRepository } from '../../domain/CapturedRequestRepository.js'

const ID_REGEX = /^[0-9a-f]{24}$/
const SHARE_ID_REGEX = /^[0-9a-f]{32}$/

function isValidId(id) {
  return typeof id === 'string' && ID_REGEX.test(id)
}

/**
 * Mints a 24-hex-char id that mimics Mongo's ObjectId layout so the
 * public API and SSE cursor pagination are identical across backends.
 * First 8 chars are unix seconds (hex), next 16 chars are random.
 */
function generateId() {
  const timeHex = Math.floor(Date.now() / 1000).toString(16).padStart(8, '0')
  const randHex = crypto.randomBytes(8).toString('hex')
  return timeHex + randHex
}

/** Translate CapturedRequest.toDocument() -> snake_case row for SQL. */
function toRow(doc) {
  const id = typeof doc._id === 'string' ? doc._id : String(doc._id)
  const createdAt =
    doc.createdAt instanceof Date ? doc.createdAt.getTime() : Number(doc.createdAt)
  const expiresAt =
    doc.expiresAt instanceof Date ? doc.expiresAt.getTime() : Number(doc.expiresAt)
  return {
    id,
    inbox_token:      doc.inboxToken,
    method:           doc.method,
    path:             doc.path,
    query:            JSON.stringify(doc.query ?? {}),
    headers:          JSON.stringify(doc.headers ?? {}),
    body:             doc.body ?? null,
    content_type:     doc.contentType,
    size:             doc.size ?? 0,
    ip:               doc.ip ?? null,
    created_at:       createdAt,
    upstream_response: doc.upstreamResponse ? JSON.stringify(doc.upstreamResponse) : null,
    share_id:         doc.shareId ?? null,
    expires_at:       expiresAt,
  }
}

/**
 * SQLite-backed CapturedRequestRepository (bun:sqlite).
 * The `requests` table mirrors the Mongo collection's effective shape;
 * ids are local 24-hex strings so the SSE cursor (`id < before`) and
 * share-id contract work the same regardless of backend.
 */
export class SqliteCapturedRequestRepository extends CapturedRequestRepository {
  constructor(db) {
    super()
    this.db = db
    this.stmt = {
      insert: db.prepare(`
        INSERT OR IGNORE INTO requests (
          id, inbox_token, method, path, query, headers, body,
          content_type, size, ip, created_at,
          upstream_response, share_id, expires_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `),
      selectShare: db.prepare(
        'SELECT share_id FROM requests WHERE id = ? AND inbox_token = ?',
      ),
      updateShare: db.prepare(
        `UPDATE requests
            SET share_id = ?
          WHERE id = ? AND inbox_token = ? AND share_id IS NULL`,
      ),
      updateUpstream: db.prepare(
        'UPDATE requests SET upstream_response = ? WHERE id = ?',
      ),
    }
  }

  nextId() {
    return generateId()
  }

  async insert(req) {
    const r = toRow(req.toDocument())
    this.stmt.insert.run(
      r.id, r.inbox_token, r.method, r.path, r.query, r.headers, r.body,
      r.content_type, r.size, r.ip, r.created_at,
      r.upstream_response, r.share_id, r.expires_at,
    )
  }

  async updateUpstreamResponse(id, upstream) {
    if (!isValidId(id)) return
    this.stmt.updateUpstream.run(JSON.stringify(upstream), id)
  }

  async upsertShareId(id, inboxToken) {
    if (!isValidId(id)) return null
    const readAndMaybeWrite = () => {
      const existing = this.stmt.selectShare.get(id, inboxToken)
      if (!existing) return null
      if (typeof existing.share_id === 'string' && SHARE_ID_REGEX.test(existing.share_id)) {
        return existing.share_id
      }
      const fresh = crypto.randomBytes(16).toString('hex')
      this.stmt.updateShare.run(fresh, id, inboxToken)
      const reread = this.stmt.selectShare.get(id, inboxToken)
      return reread?.share_id ?? fresh
    }
    return this.db.transaction(readAndMaybeWrite)()
  }
}

/**
 * Creates the `requests` table and indexes. Idempotent — safe to call
 * on every boot. Same schema serves both the writer and the read model.
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
    CREATE INDEX IF NOT EXISTS idx_requests_inbox_token_created_at
      ON requests(inbox_token, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_requests_inbox_token_share_id
      ON requests(inbox_token, share_id);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_requests_share_id_shared
      ON requests(inbox_token, share_id) WHERE share_id IS NOT NULL;
    CREATE INDEX IF NOT EXISTS idx_requests_expires_at
      ON requests(expires_at);
  `)
}
