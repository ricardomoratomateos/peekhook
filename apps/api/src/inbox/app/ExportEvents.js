/**
 * ExportEvents — produce a self-contained JSON snapshot of every
 * capture in an inbox, so a user can carry a real payload out of the
 * ephemeral sandbox (7-day TTL) and into their own test fixtures
 * before it expires.
 *
 * Returns `null` when the inbox token does not resolve; otherwise a
 * plain object the transport serialises as a downloadable document:
 *
 *   {
 *     inbox:      { token, exportedAt },
 *     count:      <number of events>,
 *     events:     [ <CapturedRequest DTO>, ... ]   // newest first
 *   }
 *
 * The event DTOs are the same read projection the inspector renders
 * (no inboxToken, no TTL, no shareId leakage beyond what the UI
 * already shows), so the export is safe to hand to another tool.
 *
 * @param {{
 *   inboxes:  import('../domain/InboxRepository.js').InboxRepository,
 *   requests: import('../domain/RequestListReadModel.js').RequestListReadModel,
 *   now?:     () => Date,
 * }} deps
 */
export class ExportEvents {
  constructor({ inboxes, requests, now }) {
    this.inboxes  = inboxes
    this.requests = requests
    this.now      = now ?? (() => new Date())
  }

  /**
   * @param {{ token: string, ids?: string[] | null }} cmd
   *   When `ids` is a non-empty array, only those captures are exported
   *   (subset export from the inspector's selection); otherwise the whole
   *   inbox is exported.
   * @returns {Promise<null | { inbox: object, count: number, events: object[] }>}
   */
  async execute({ token, ids }) {
    const inbox = await this.inboxes.findByToken(token)
    if (!inbox) return null

    let events = await this.requests.listAll({ inboxToken: token })
    if (Array.isArray(ids) && ids.length > 0) {
      const wanted = new Set(ids)
      events = events.filter((e) => wanted.has(e.id))
    }
    return {
      inbox:  { token, exportedAt: this.now().toISOString() },
      count:  events.length,
      events,
    }
  }
}
