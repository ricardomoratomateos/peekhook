import { Outcome } from '../domain/Outcome.js'
import { CapturedRequest } from '../domain/CapturedRequest.js'
import { sanitizeHeaders } from '../domain/headerSanitizer.js'

/**
 * CaptureRequest — stores an incoming HTTP request in a sandbox inbox.
 *
 * Verifies the inbox exists and is willing to accept a capture (sliding
 * 60/min rate window, lifetime 1,000-cap), sanitizes headers to strip
 * control / RTL-override characters before persistence, then creates
 * and persists a CapturedRequest. The expiresAt is inherited from the
 * inbox so all records for an inbox have a consistent TTL. Returns the
 * inbox's responseConfig alongside the Outcome so the transport adapter
 * can apply it (or fall back to the default acknowledgement).
 *
 * Limitation enforcement — the inbox aggregate carries the counters
 * that back `MAX_CAPTURE_COUNT` and `RATE_LIMIT_MAX_REQUESTS`. The
 * atomic `tryConsumeCaptureSlot` repository call reserves a slot
 * BEFORE the request body is persisted; if the slot is denied, no
 * document is written. This means a denied capture neither shows up
 * in the inspector feed nor counts against the limit (the counters
 * only move on success).
 *
 * Optional `recordSchema` use case: when supplied, the request body is
 * also folded into the inbox's payload schema history (ROADMAP #5/#6).
 * The call is wrapped in try/catch — analytics must never fail the
 * user-visible capture. When omitted, this use case is a clean
 * pass-through.
 *
 * @param {{
 *   inboxes:      import('../domain/InboxRepository.js').InboxRepository,
 *   requests:     import('../domain/CapturedRequestRepository.js').CapturedRequestRepository,
 *   recordSchema?: { execute(cmd: { inboxToken: string, body: string }): Promise<void> },
 *   now?:         () => Date,
 *   logger?:      { warn: (msg: string) => void } | null,
 * }} deps
 */
export class CaptureRequest {
  constructor({ inboxes, requests, recordSchema, now, logger }) {
    this.inboxes      = inboxes
    this.requests     = requests
    this.recordSchema = recordSchema ?? null
    this.now          = now ?? (() => new Date())
    this.logger       = logger ?? null
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
   * @returns {Promise<{
   *   outcome: string,
   *   id?: *,
   *   responseConfig: null | object,
   *   forwardTo: null | string,
   *   retryAfterSec?: number,
   * }>}
   */
  async execute({ inboxToken, method, path, query, headers, body, contentType, size, ip }) {
    const reserved = await this.inboxes.tryConsumeCaptureSlot(inboxToken, this.now())
    if (!reserved.ok) {
      if (reserved.reason === 'inbox_not_found') {
        return { outcome: Outcome.INBOX_NOT_FOUND, responseConfig: null, forwardTo: null }
      }
      if (reserved.reason === 'capacity_exceeded') {
        return { outcome: Outcome.CAPACITY_EXCEEDED, responseConfig: null, forwardTo: null }
      }
      if (reserved.reason === 'rate_limited') {
        const retryAfterSec = Math.max(1, Math.ceil((reserved.retryAfterMs ?? 60_000) / 1000))
        return {
          outcome:        Outcome.RATE_LIMITED,
          responseConfig: null,
          forwardTo:      null,
          retryAfterSec,
        }
      }
      return { outcome: Outcome.INBOX_NOT_FOUND, responseConfig: null, forwardTo: null }
    }

    const inbox = reserved.inbox
    const id  = this.requests.nextId()
    const now = this.now()

    const { sanitized: cleanHeaders, stripped: strippedHeaders } = sanitizeHeaders(headers)
    if (strippedHeaders && this.logger) {
      this.logger.warn(`CaptureRequest: stripped unsafe characters from headers on inboxToken=${inboxToken}`)
    }

    const req = CapturedRequest.create({
      id,
      inboxToken,
      method,
      path,
      query,
      headers:  cleanHeaders,
      body,
      contentType,
      size,
      ip,
      now,
      expiresAt: inbox.expiresAt,
    })

    await this.requests.insert(req)

    if (this.recordSchema) {
      try {
        await this.recordSchema.execute({ inboxToken, body: body ?? '' })
      } catch (_err) {
        /* analytics failure must not fail the capture */
      }
    }

    return {
      outcome:        Outcome.CAPTURED,
      id,
      responseConfig: inbox.responseConfig ?? null,
      forwardTo:      inbox.forwardTo      ?? null,
    }
  }
}
