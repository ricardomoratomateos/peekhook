/**
 * Port: append-only audit log for MCP tool calls.
 *
 * Every authenticated `tools/call` lands here. The transport writes
 * AFTER auth + rate-limit pass and BEFORE tool execution, so the
 * log records intent (not just success). Implementations MUST be
 * best-effort: a Mongo failure must NOT bubble up and fail the MCP
 * call. Failed writes go to stderr and the call proceeds.
 *
 * Schema (one document per call):
 *   {
 *     tokenHash: string,        // SHA-256 hex, never plaintext
 *     tool:      string,        // tool name (list_events, etc.)
 *     params:    object,        // sanitised: large string fields → { length }
 *     ip:        string,        // request IP, x-forwarded-for honoured upstream
 *     timestamp: Date,          // UTC, server clock
 *   }
 *
 * Index on `(tokenHash, timestamp)` lives in the implementation.
 */
export class McpAuditLog {
  /**
   * @param {{
   *   tokenHash: string,
   *   tool:      string,
   *   params:    object,
   *   ip:        string,
   *   timestamp: Date,
   * }} entry
   * @returns {Promise<void>}
   */
  async append(_entry) {
    throw new Error('McpAuditLog.append not implemented')
  }
}