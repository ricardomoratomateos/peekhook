/**
 * Port: read and write the inbox's MCP token hash.
 *
 * The MCP feature reuses the existing `inboxes` collection — each doc
 * gains an `mcpTokenHash` field. This port keeps the hash storage
 * concern out of the use cases (`VerifyMcpToken`, `MintMcpToken`).
 *
 * Implemented by `MongoMcpAuthRepository` (infra).
 */
export class McpAuthRepository {
  /**
   * @param {string} inboxToken
   * @returns {Promise<object|null>} inbox document (with `mcpTokenHash`),
   *   or `null` if no inbox matches the token
   */
  async findByInboxToken(inboxToken) {
    throw new Error('McpAuthRepository.findByInboxToken not implemented')
  }

  /**
   * Resolve the inbox whose stored `mcpTokenHash` matches the supplied
   * SHA-256 hex. Used by the HTTP transport to authenticate requests
   * from a `Bearer` header (the bearer token is the mcp_token plaintext;
   * we hash it once on the request path then look it up).
   *
   * Returns the inbox doc (with `mcpTokenHash` field omitted from the
   * projection so it cannot be re-hashed downstream) or `null` if no
   * inbox is enrolled with that hash.
   *
   * @param {string} hashHex SHA-256 hex of the candidate mcp token
   * @returns {Promise<object|null>}
   */
  async findByMcpTokenHash(hashHex) {
    throw new Error('McpAuthRepository.findByMcpTokenHash not implemented')
  }

  /**
   * Persist a freshly minted SHA-256 hex hash for an inbox.
   *
   * Idempotent: overwrites any prior hash on the same token (tokens
   * are never rotated in this version — a fresh inbox always gets a
   * fresh hash via `MintMcpToken`).
   *
   * @param {string} inboxToken
   * @param {string} hashHex
   * @returns {Promise<void>}
   */
  async setMcpTokenHash(inboxToken, hashHex) {
    throw new Error('McpAuthRepository.setMcpTokenHash not implemented')
  }
}
