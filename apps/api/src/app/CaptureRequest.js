import { Outcome } from '../domain/Outcome.js'
import { CapturedRequest } from '../domain/CapturedRequest.js'

/**
 * CaptureRequest — stores an incoming HTTP request in a sandbox inbox.
 *
 * Verifies the inbox exists, then creates and persists a CapturedRequest.
 * The expiresAt is inherited from the inbox so all records for one inbox
 * have a consistent TTL. Returns the inbox's responseConfig alongside
 * the Outcome so the transport adapter can apply it (or fall back to the
 * default acknowledgement).
 *
 * @param {{
 *   inboxes:  import('../domain/InboxRepository.js').InboxRepository,
 *   requests: import('../domain/CapturedRequestRepository.js').CapturedRequestRepository,
 *   now?: () => Date,
 * }} deps
 */
export class CaptureRequest {
  constructor({ inboxes, requests, now }) {
    this.inboxes  = inboxes
    this.requests = requests
    this.now      = now ?? (() => new Date())
  }

  /**
   * @param {{
   *   inboxToken:  string,
   *   method:      string,
   *   path:        string,
   *   query:       object,
   *   headers:     object,
   *   body:        string,
   *   contentType: string,
   *   size:        number,
   *   ip:          string,
   * }} cmd
   * @returns {Promise<{ outcome: string, id?: *, responseConfig: null | object }>}
   */
  async execute({ inboxToken, method, path, query, headers, body, contentType, size, ip }) {
    const inbox = await this.inboxes.findByToken(inboxToken)
    if (!inbox) return { outcome: Outcome.INBOX_NOT_FOUND, responseConfig: null }

    const id  = this.requests.nextId()
    const now = this.now()

    const req = CapturedRequest.create({
      id,
      inboxToken,
      method,
      path,
      query,
      headers,
      body,
      contentType,
      size,
      ip,
      now,
      expiresAt: inbox.expiresAt,
    })

    await this.requests.insert(req)
    return { outcome: Outcome.CAPTURED, id, responseConfig: inbox.responseConfig ?? null }
  }
}
