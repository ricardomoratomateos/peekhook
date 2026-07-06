import { Outcome } from '../domain/Outcome.js'
import { validateForwardUrl } from '../domain/SandboxInbox.js'
import { checkForwardLoop } from '../domain/loopRule.js'

/**
 * ConfigureForward — sets or clears the forwarding target for a sandbox inbox.
 *
 * Mirrors ConfigureResponse's shape: validates the URL at the boundary,
 * returns NOT_FOUND if the inbox does not exist, INVALID on a bad value,
 * UPDATED on a successful set, CLEARED on null.
 *
 * Two layers of validation:
 *   1. validateForwardUrl — syntax (http(s), byte cap, parseable)
 *   2. checkForwardLoop    — semantic (the URL would recurse into this
 *                            ingest origin via /i/...). Surfaced at
 *                            config time so the user never saves a
 *                            forward target that 502s on every request.
 *
 * Persistence is a direct repo write — the validators own the rule set.
 *
 * @param {{
 *   inboxes:    import('../domain/InboxRepository.js').InboxRepository,
 *   ingestUrl:  string,   // e.g. "https://peekhook.dev" — fed to the loop rule
 * }} deps
 */
export class ConfigureForward {
  constructor({ inboxes, ingestUrl }) {
    this.inboxes   = inboxes
    this.ingestUrl = ingestUrl
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

    if (cleaned !== null) {
      const loop = checkForwardLoop(cleaned, this.ingestUrl)
      if (!loop.ok) {
        return { outcome: Outcome.INVALID, forwardTo: null, error: loop.message }
      }
    }

    await this.inboxes.updateForwardTo(token, cleaned)

    if (cleaned === null) return { outcome: Outcome.CLEARED, forwardTo: null }
    return { outcome: Outcome.UPDATED, forwardTo: cleaned }
  }
}
