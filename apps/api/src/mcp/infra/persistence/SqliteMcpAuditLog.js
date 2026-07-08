import { McpAuditLog } from '../../domain/McpAuditLog.js'

/**
 * Creates the `mcp_audit_log` table and its `(token_hash, timestamp)`
 * index. Idempotent — safe to call on every boot. Schema mirrors
 * Mongo's `mcp_audit_log` collection shape one-for-one:
 *   { tokenHash, tool, params (serialised JSON), ip, timestamp }
 *
 * The index supports the same `(token_hash, timestamp DESC)` lookups
 * the Mongo version serves (per-token recent activity). Kept in a
 * separate `migrate(db)` so the composition root can call each
 * adapter's migrate independently — same convention as every other
 * SQLite adapter in this repo.
 *
 * @param {import('bun:sqlite').Database} db
 */
export function migrate(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS mcp_audit_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      token_hash TEXT NOT NULL,
      tool TEXT NOT NULL,
      params TEXT,
      ip TEXT,
      timestamp INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_mcp_audit_log_token_hash_timestamp
      ON mcp_audit_log(token_hash, timestamp DESC);
  `)
}

/**
 * SQLite-backed McpAuditLog.
 *
 * Writes one row per authenticated `tools/call`. The token reaches
 * this table as a SHA-256 hash only — the plaintext never enters the
 * pipeline.
 *
 * Errors are caught and logged to stderr. The MCP call proceeds
 * regardless — audit must never be the reason a call fails. The
 * `append` method returns `void` either way. Matches the
 * best-effort contract of `MongoMcpAuditLog`.
 */
export class SqliteMcpAuditLog extends McpAuditLog {
  /**
   * @param {import('bun:sqlite').Database} db
   */
  constructor(db) {
    super()
    this.db = db
    this.stmt = db.prepare(`
      INSERT INTO mcp_audit_log (token_hash, tool, params, ip, timestamp)
      VALUES (?, ?, ?, ?, ?)
    `)
  }

  async append({ tokenHash, tool, params, ip, timestamp }) {
    try {
      const ts  = timestamp instanceof Date ? timestamp.getTime() : (timestamp ?? Date.now())
      const json = JSON.stringify(params ?? {})
      this.stmt.run(
        typeof tokenHash === 'string' ? tokenHash : '',
        typeof tool      === 'string' ? tool      : '',
        json,
        typeof ip        === 'string' ? ip        : null,
        ts,
      )
    } catch (err) {
      console.error('[mcp_audit_log] append failed:', err && err.message ? err.message : err)
    }
  }
}
