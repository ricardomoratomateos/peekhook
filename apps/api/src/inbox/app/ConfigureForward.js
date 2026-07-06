import { Outcome } from '../domain/Outcome.js'
import { validateForwardUrl } from '../domain/SandboxInbox.js'

/**
 * ConfigureForward — sets or clears the forwarding target for a sandbox inbox.
 *
 * Mirrors ConfigureResponse's shape: validates the URL at the boundary,
 * returns NOT_FOUND if the inbox does not exist, INVALID on a bad value,
 * UPDATED on a successful set, CLEARED on null.
 *
 * Persistence is a direct repo write — the validator owns the rule set.
 *
 * @param {{
 *   inboxes: import('../domain/InboxRepository.js').InboxRepository,
 * }} deps
 */
export class ConfigureForward {
  constructor({ inboxes }) {
    this.inboxes = inboxes
  }

  /**
   * @param {{
   *   token: string,
   *   forwardTo: null | string,
   * }} cmd
   * @returns {Promise<{ outcome: string, forwardTo: null | string, error?: string }>}
   */
  async execute({ token, forwardTo }) {
    const inbox = await this.inboxes.findByToken(token)
    if (!inbox) return { outcome: Outcome.NOT_FOUND, forwardTo: null }

    let cleaned
    try {
      cleaned = validateForwardUrl(forwardTo)
    } catch (err) {
      return { outcome: Outcome.INVALID, forwardTo: null, error: err.message }
    }

    await this.inboxes.updateForwardTo(token, cleaned)

    if (cleaned === null) return { outcome: Outcome.CLEARED, forwardTo: null }
    return { outcome: Outcome.UPDATED, forwardTo: cleaned }
  }
}
