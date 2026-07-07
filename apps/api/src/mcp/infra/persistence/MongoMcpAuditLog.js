import { McpAuditLog } from '../../domain/McpAuditLog.js'

const COLLECTION = 'mcp_audit_log'

/**
 * Mongo-backed McpAuditLog.
 *
 * Writes one document per authenticated `tools/call`. The token
 * reaches this collection as a SHA-256 hash only — the plaintext
 * never enters the pipeline.
 *
 * Index on `(tokenHash, timestamp)` is created on the first write
 * (idempotent). Doing it lazily keeps the integration tests free of
 * an explicit setup step and matches the Mongo "create if missing"
 * behaviour.
 *
 * Errors are caught and logged to stderr. The MCP call proceeds
 * regardless — audit must never be the reason a call fails. The
 * `append` method returns `void` either way.
 */
export class MongoMcpAuditLog extends McpAuditLog {
  constructor(db) {
    super()
    this.col     = db.collection(COLLECTION)
    this.indexed = false
  }

  async append({ tokenHash, tool, params, ip, timestamp }) {
    try {
      if (!this.indexed) {
        await this.col.createIndex({ tokenHash: 1, timestamp: -1 })
        this.indexed = true
      }
      await this.col.insertOne({
        tokenHash,
        tool,
        params:    params    ?? {},
        ip:        ip        ?? null,
        timestamp: timestamp ?? new Date(),
      })
    } catch (err) {
      console.error('[mcp_audit_log] append failed:', err && err.message ? err.message : err)
    }
  }
}