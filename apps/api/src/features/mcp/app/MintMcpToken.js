import crypto from 'node:crypto'

const TOKEN_BYTES = 32

/**
 * MintMcpToken — mints and persists an MCP token for an inbox.
 *
 * Generates a fresh 32-byte random base64url secret, stores SHA-256
 * hex of that secret on the inbox doc, and returns the plaintext.
 * The plaintext is returned ONLY here — callers (`apiRoute`) must
 * surface it to the user once at create time and never re-emit it.
 *
 * Implemented as a parallel use case to `CreateInbox` so the inbox
 * module stays untouched. `apiRoute`'s `POST /api/inboxes` handler
 * calls both.
 *
 * @param {{
 *   mcpAuth: import('../domain/McpAuthRepository.js').McpAuthRepository,
 *   randomBytes?: (n: number) => Buffer,
 * }} deps
 */
export class MintMcpToken {
  constructor({ mcpAuth, randomBytes }) {
    this.mcpAuth = mcpAuth
    this.randomBytes = randomBytes ?? ((n) => crypto.randomBytes(n))
  }

  /**
   * @param {{ inboxToken: string }} cmd
   * @returns {Promise<{ mcpToken: string }>}
   */
  async execute({ inboxToken }) {
    if (typeof inboxToken !== 'string' || inboxToken.length === 0) {
      throw new Error('inboxToken required')
    }
    const plaintext = this.randomBytes(TOKEN_BYTES).toString('base64url')
    const hashHex = crypto.createHash('sha256').update(plaintext).digest('hex')
    await this.mcpAuth.setMcpTokenHash(inboxToken, hashHex)
    return { mcpToken: plaintext }
  }
}
