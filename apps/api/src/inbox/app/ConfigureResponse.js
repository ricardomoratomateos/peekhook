import { Outcome } from '../domain/Outcome.js'
import { validateResponseConfig } from '../domain/SandboxInbox.js'

/**
 * ConfigureResponse — sets or clears the ingest response configuration
 * for a sandbox inbox.
 *
 * Validates against the domain rule set (status 100–599, allowlisted
 * content-type, string body ≤ 64 KB, boolean enabled). Returns
 * NOT_FOUND if the inbox does not exist (e.g. expired), INVALID on a
 * bad payload, or UPDATED/CLEARED on success.
 *
 * Side effect: after a successful set, this use case also writes the
 * computed UTF-8 byte size of the mock-reply body (`mockBodySize`) to
 * the inbox document via `updateResponseConfig(token, cfg, mockBodySize)`.
 * `SandboxInbox.mockBodySize` is the aggregate-side mirror of that
 * field — both go to 0 when the reply is cleared.
 *
 * The repository returns plain Mongo documents, not domain aggregates —
 * so we don't go through `SandboxInbox.setResponseConfig` here; the
 * validator owns the rule set, the use case owns the persistence call.
 *
 * @param {{
 *   inboxes: import('../domain/InboxRepository.js').InboxRepository,
 * }} deps
 */
export class ConfigureResponse {
  constructor({ inboxes }) {
    this.inboxes = inboxes
  }

  /**
   * @param {{
   *   token: string,
   *   responseConfig: null | { enabled: boolean, status: number, contentType: string, body: string },
   * }} cmd
   * @returns {Promise<{ outcome: string, responseConfig: null | object, mockBodySize?: number, error?: string }>}
   */
  async execute({ token, responseConfig }) {
    const inbox = await this.inboxes.findByToken(token)
    if (!inbox) return { outcome: Outcome.NOT_FOUND, responseConfig: null }

    let cleaned
    try {
      cleaned = validateResponseConfig(responseConfig)
    } catch (err) {
      return { outcome: Outcome.INVALID, responseConfig: null, error: err.message }
    }

    const mockBodySize = cleaned ? Buffer.byteLength(cleaned.body, 'utf8') : 0
    await this.inboxes.updateResponseConfig(token, cleaned, mockBodySize)

    if (cleaned === null) return { outcome: Outcome.CLEARED, responseConfig: null, mockBodySize: 0 }
    return { outcome: Outcome.UPDATED, responseConfig: cleaned, mockBodySize }
  }
}
