import crypto from 'node:crypto'

/**
 * VerifyMcpToken — gate every MCP tool call.
 *
 * Looks up the inbox for the supplied inbox token, hashes the
 * candidate mcp token (SHA-256 hex) and compares in constant time
 * against the stored hash. Returns `{ ok: true, inbox }` on success
 * or `{ ok: false, reason }` on lookup miss / hash mismatch / missing
 * fields.
 *
 * Does not throw on auth failure — the dispatcher decides how to
 * surface it (we surface a JSON-RPC error result).
 *
 * @param {{
 *   mcpAuth: import('../domain/McpAuthRepository.js').McpAuthRepository,
 *   timingSafeEqual?: (a: Buffer, b: Buffer) => boolean,
 * }} deps
 */
export class VerifyMcpToken {
  constructor({ mcpAuth, timingSafeEqual }) {
    this.mcpAuth = mcpAuth
    this.timingSafeEqual = timingSafeEqual ?? crypto.timingSafeEqual
  }

  /**
   * @param {{ inboxToken: string, mcpToken: string }} cmd
   * @returns {Promise<
   *   { ok: true, inbox: object } | { ok: false, reason: string }
   * >}
   */
  async execute({ inboxToken, mcpToken }) {
    if (typeof inboxToken !== 'string' || inboxToken.length === 0) {
      return { ok: false, reason: 'inbox_token missing' }
    }
    if (typeof mcpToken !== 'string' || mcpToken.length === 0) {
      return { ok: false, reason: 'mcp_token missing' }
    }

    const inbox = await this.mcpAuth.findByInboxToken(inboxToken)
    if (!inbox) return { ok: false, reason: 'inbox not found' }
    if (!inbox.mcpTokenHash) return { ok: false, reason: 'mcp not enabled for inbox' }

    const candidate = crypto.createHash('sha256').update(mcpToken).digest('hex')
    const stored = inbox.mcpTokenHash
    const a = Buffer.from(candidate, 'hex')
    const b = Buffer.from(stored, 'hex')
    if (a.length !== b.length) return { ok: false, reason: 'mcp_token invalid' }
    if (!this.timingSafeEqual(a, b)) return { ok: false, reason: 'mcp_token invalid' }
    return { ok: true, inbox }
  }
}
