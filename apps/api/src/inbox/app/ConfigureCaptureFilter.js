import { Outcome } from '../domain/Outcome.js'
import { validateCaptureFilter } from '../domain/SandboxInbox.js'

/**
 * ConfigureCaptureFilter — sets or clears the capture allowlist for a
 * sandbox inbox.
 *
 * Mirrors ConfigureForward's shape: validates at the boundary, returns
 * NOT_FOUND if the inbox does not exist, INVALID on a malformed filter,
 * UPDATED on a successful set, CLEARED when the filter normalises to null
 * (either an explicit null or a filter whose dimensions are all empty).
 *
 * The validator (`validateCaptureFilter`) owns the rule set and normalises
 * the payload; persistence is a direct repo write.
 *
 * @param {{
 *   inboxes: import('../domain/InboxRepository.js').InboxRepository,
 * }} deps
 */
export class ConfigureCaptureFilter {
  constructor({ inboxes }) {
    this.inboxes = inboxes
  }

  /**
   * @param {{ token: string, captureFilter: unknown }} cmd
   * @returns {Promise<{ outcome: string, captureFilter: null | object, error?: string }>}
   */
  async execute({ token, captureFilter }) {
    const inbox = await this.inboxes.findByToken(token)
    if (!inbox) return { outcome: Outcome.NOT_FOUND, captureFilter: null }

    let cleaned
    try {
      cleaned = validateCaptureFilter(captureFilter)
    } catch (err) {
      return { outcome: Outcome.INVALID, captureFilter: null, error: err.message }
    }

    await this.inboxes.updateCaptureFilter(token, cleaned)

    if (cleaned === null) return { outcome: Outcome.CLEARED, captureFilter: null }
    return { outcome: Outcome.UPDATED, captureFilter: cleaned }
  }
}
