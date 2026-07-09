import { Outcome } from '../domain/Outcome.js'

/**
 * ClearInbox — purge every captured request for an inbox and reset the
 * lifetime capture counter.
 *
 * Motivation: the inbox carries a 1,000-capture lifetime cap
 * (ROADMAP "Per-inbox request cap"). Once hit, further captures 429 and
 * the only recovery used to be minting a new inbox — which throws away
 * the webhook URL the user already configured at their provider. This
 * use case lets them keep the same token: it deletes the captures AND
 * resets `captureCount` / the rate window so the cap frees up again.
 *
 * Returns NOT_FOUND when the token does not resolve (e.g. expired),
 * CLEARED with the number of deleted captures otherwise.
 *
 * @param {{
 *   inboxes:  import('../domain/InboxRepository.js').InboxRepository,
 *   requests: import('../domain/CapturedRequestRepository.js').CapturedRequestRepository,
 * }} deps
 */
export class ClearInbox {
  constructor({ inboxes, requests }) {
    this.inboxes  = inboxes
    this.requests = requests
  }

  /**
   * @param {{ token: string }} cmd
   * @returns {Promise<{ outcome: string, deleted: number }>}
   */
  async execute({ token }) {
    const inbox = await this.inboxes.findByToken(token)
    if (!inbox) return { outcome: Outcome.NOT_FOUND, deleted: 0 }

    const deleted = await this.requests.deleteByInboxToken(token)
    await this.inboxes.resetCaptureCount(token)

    return { outcome: Outcome.CLEARED, deleted }
  }
}
