import { InboxRepository } from '../../domain/InboxRepository.js'
import {
  MAX_CAPTURE_COUNT,
  RATE_LIMIT_WINDOW_MS,
  RATE_LIMIT_MAX_REQUESTS,
} from '../../domain/SandboxInbox.js'

/**
 * Idempotent schema setup. Call once at process start, before
 * constructing the repository. The class itself does not auto-migrate
 * so wiring code (composition root) controls the lifecycle.
 *
 * The `mcp_token_hash` column is added in two steps so the migration
 * is safe to run against both fresh and pre-existing databases:
 *   1. `CREATE TABLE IF NOT EXISTS` includes the column, so fresh
 *      databases get it on first boot.
 *   2. `ALTER TABLE ... ADD COLUMN` runs unconditionally but its
 *      "duplicate column name" failure is swallowed (SQLite has no
 *      `ADD COLUMN IF NOT EXISTS`). Existing databases upgrade in
 *      place; fresh ones no-op on the ALTER.
 *
 * @param {import('bun:sqlite').Database} db
 */
export function migrate(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS inboxes (
      token TEXT PRIMARY KEY,
      capture_count INTEGER NOT NULL DEFAULT 0,
      rate_window_started_at INTEGER,
      rate_window_count INTEGER NOT NULL DEFAULT 0,
      response_config TEXT,
      mock_body_size INTEGER NOT NULL DEFAULT 0,
      forward_to TEXT,
      expires_at INTEGER NOT NULL,
      mcp_token_hash TEXT,
      capture_filter TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_inboxes_expires_at ON inboxes(expires_at);
  `)
  // Additive columns, added in two steps so the migration is safe against
  // both fresh and pre-existing databases (SQLite has no ADD COLUMN IF NOT
  // EXISTS — the "duplicate column name" failure is swallowed).
  for (const ddl of [
    'ALTER TABLE inboxes ADD COLUMN mcp_token_hash TEXT',
    'ALTER TABLE inboxes ADD COLUMN capture_filter TEXT',
  ]) {
    try {
      db.exec(ddl)
    } catch (_err) {
      // Column already exists — safe to ignore.
    }
  }
}

/**
 * Translate a raw SQLite row into the inbox document shape that the
 * application expects (and that the Mongo adapter returns): Dates
 * instead of unix-ms integers, parsed JSON for responseConfig, and a
 * nested `rateWindow = { startedAt, count }` object.
 *
 * @param {Record<string, any>} row
 */
function rowToDoc(row) {
  const rateWindowStartedAt = row.rate_window_started_at == null
    ? null
    : new Date(row.rate_window_started_at)
  return {
    token: row.token,
    captureCount: row.capture_count,
    rateWindow: { startedAt: rateWindowStartedAt, count: row.rate_window_count },
    responseConfig: row.response_config == null ? null : JSON.parse(row.response_config),
    mockBodySize: row.mock_body_size,
    forwardTo: row.forward_to == null ? null : row.forward_to,
    captureFilter: row.capture_filter == null ? null : JSON.parse(row.capture_filter),
    expiresAt: new Date(row.expires_at),
  }
}

const SELECT_COLUMNS = `
  token,
  capture_count,
  rate_window_started_at,
  rate_window_count,
  response_config,
  mock_body_size,
  forward_to,
  capture_filter,
  expires_at
`

/**
 * SQLite (bun:sqlite) implementation of the InboxRepository port.
 *
 * Atomicity: SQLite serialises writes by default — only one writer
 * can hold the database at a time. The `tryConsumeCaptureSlot` method
 * wraps its SELECT / compute / UPDATE sequence in `db.transaction(...)`
 * so a concurrent capture cannot interleave between the read and the
 * update. This is the SQLite equivalent of Mongo's two-phase
 * `findOneAndUpdate` with conditional filters: by the time the UPDATE
 * runs, we hold the writer lock and our computed result is guaranteed
 * to be the result that lands on disk.
 *
 * Also satisfies the `McpAuthRepository` port so the local SQLite
 * mode can mint + resolve MCP bearer tokens against the same `inboxes`
 * table. The MCP methods are additive — the rest of the contract is
 * unchanged.
 */
export class SqliteInboxRepository extends InboxRepository {
  /**
   * @param {import('bun:sqlite').Database} db
   */
  constructor(db) {
    super()
    this.db = db
    this.stmt = {
      findByMcpTokenHash: db.prepare('SELECT * FROM inboxes WHERE mcp_token_hash = ?'),
      setMcpTokenHash:    db.prepare('UPDATE inboxes SET mcp_token_hash = ? WHERE token = ?'),
    }
  }

  async findByToken(token) {
    const row = this.db
      .query(`SELECT ${SELECT_COLUMNS} FROM inboxes WHERE token = ?`)
      .get(token)
    return row ? rowToDoc(row) : null
  }

  // ------------------------------------------------------------------
  // McpAuthRepository methods (same SqliteInboxRepository instance is
  // passed as `mcpAuth` to buildApp in local mode — see cli.js).
  // ------------------------------------------------------------------

  async findByInboxToken(inboxToken) {
    return this.findByToken(inboxToken)
  }

  async findByMcpTokenHash(hashHex) {
    if (typeof hashHex !== 'string' || hashHex.length === 0) return null
    const row = this.stmt.findByMcpTokenHash.get(hashHex)
    return row ?? null
  }

  async setMcpTokenHash(inboxToken, hashHex) {
    this.stmt.setMcpTokenHash.run(hashHex, inboxToken)
  }

  async insert(inbox) {
    const doc = inbox.toDocument()
    this.db
      .query(`
        INSERT INTO inboxes (
          token,
          capture_count,
          rate_window_started_at,
          rate_window_count,
          response_config,
          mock_body_size,
          forward_to,
          capture_filter,
          expires_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
        doc.token,
        doc.captureCount,
        doc.rateWindow.startedAt instanceof Date ? doc.rateWindow.startedAt.getTime() : null,
        doc.rateWindow.count,
        doc.responseConfig == null ? null : JSON.stringify(doc.responseConfig),
        doc.mockBodySize,
        doc.forwardTo,
        doc.captureFilter == null ? null : JSON.stringify(doc.captureFilter),
        doc.expiresAt.getTime(),
      )
  }

  async updateResponseConfig(token, responseConfig, mockBodySize = 0) {
    this.db
      .query(`
        UPDATE inboxes
        SET response_config = ?, mock_body_size = ?
        WHERE token = ?
      `)
      .run(
        responseConfig == null ? null : JSON.stringify(responseConfig),
        mockBodySize,
        token,
      )
  }

  async updateForwardTo(token, forwardTo) {
    this.db
      .query(`
        UPDATE inboxes
        SET forward_to = ?
        WHERE token = ?
      `)
      .run(forwardTo, token)
  }

  async updateCaptureFilter(token, captureFilter) {
    this.db
      .query(`
        UPDATE inboxes
        SET capture_filter = ?
        WHERE token = ?
      `)
      .run(captureFilter == null ? null : JSON.stringify(captureFilter), token)
  }

  async resetCaptureCount(token) {
    this.db
      .query(`
        UPDATE inboxes
        SET capture_count = 0,
            rate_window_started_at = NULL,
            rate_window_count = 0
        WHERE token = ?
      `)
      .run(token)
  }

  async tryConsumeCaptureSlot(token, now) {
    return this.db.transaction(() => {
      const row = this.db
        .query(`SELECT ${SELECT_COLUMNS} FROM inboxes WHERE token = ?`)
        .get(token)
      if (!row) {
        return { ok: false, inbox: null, reason: 'inbox_not_found' }
      }

      const inbox = rowToDoc(row)

      if ((inbox.captureCount ?? 0) >= MAX_CAPTURE_COUNT) {
        return { ok: false, inbox, reason: 'capacity_exceeded' }
      }

      const startedAt = inbox.rateWindow.startedAt
      const count = inbox.rateWindow.count ?? 0
      const nowMs = now.getTime()

      if (
        startedAt &&
        (nowMs - startedAt.getTime()) < RATE_LIMIT_WINDOW_MS &&
        count >= RATE_LIMIT_MAX_REQUESTS
      ) {
        const retryAfterMs = RATE_LIMIT_WINDOW_MS - (nowMs - startedAt.getTime())
        return { ok: false, inbox, reason: 'rate_limited', retryAfterMs }
      }

      const windowExpired = !startedAt || (nowMs - startedAt.getTime()) >= RATE_LIMIT_WINDOW_MS
      const newStartedAt = windowExpired ? now : startedAt
      const newCount = windowExpired ? 1 : count + 1
      const newCaptureCount = (inbox.captureCount ?? 0) + 1

      this.db
        .query(`
          UPDATE inboxes
          SET capture_count = ?,
              rate_window_started_at = ?,
              rate_window_count = ?
          WHERE token = ?
        `)
        .run(
          newCaptureCount,
          newStartedAt.getTime(),
          newCount,
          token,
        )

      return {
        ok: true,
        inbox: {
          ...inbox,
          captureCount: newCaptureCount,
          rateWindow: { startedAt: newStartedAt, count: newCount },
        },
      }
    })()
  }
}
