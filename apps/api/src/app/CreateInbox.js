import { Outcome } from '../domain/Outcome.js'
import { SandboxInbox } from '../domain/SandboxInbox.js'

/**
 * CreateInbox — the inbox-creation command for the Sandbox module.
 *
 * Mints a fresh inbox token, persists it, and returns the token and
 * expiry so the HTTP adapter can construct the full ingest URL. Has no
 * knowledge of Mongo or HTTP — the URL is assembled by the transport adapter.
 *
 * @param {{
 *   inboxes: import('../domain/InboxRepository.js').InboxRepository,
 *   now?: () => Date,
 * }} deps
 */
export class CreateInbox {
  constructor({ inboxes, now }) {
    this.inboxes = inboxes
    this.now = now ?? (() => new Date())
  }

  /**
   * @returns {Promise<{ outcome: string, token: string, expiresAt: Date }>}
   */
  async execute() {
    const inbox = SandboxInbox.create({ now: this.now() })
    await this.inboxes.insert(inbox)
    return { outcome: Outcome.CREATED, token: inbox.token, expiresAt: inbox.expiresAt }
  }
}
