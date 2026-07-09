import { Outcome } from '../domain/Outcome.js'
import { CapturedRequest } from '../domain/CapturedRequest.js'
import { sanitizeHeaders } from '../domain/headerSanitizer.js'
import { matchesCaptureFilter } from '../domain/captureFilterRule.js'

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
 *   enforceLimits?: boolean,  // default true; false skips the 60/min +
 *                             // 1,000-cap slot reservation (local `peekgrok`
 *                             // proxy mode, where the user owns the machine
 *                             // and a full-app proxy would blow the cap in
 *                             // seconds). See tryConsumeCaptureSlot.
 * }} deps
 */
export class CaptureRequest {
  constructor({ inboxes, requests, recordSchema, now, logger, enforceLimits }) {
    this.inboxes       = inboxes
    this.requests      = requests
    this.recordSchema  = recordSchema ?? null
    this.now           = now ?? (() => new Date())
    this.logger        = logger ?? null
    this.enforceLimits = enforceLimits !== false
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
  async execute({ inboxToken, method, path, query, headers, body, contentType, size, ip, upstreamResponse }) {
    // Read the inbox up front so the capture filter can be evaluated BEFORE
    // any slot is reserved. A request the allowlist rejects must not consume
    // the lifetime cap or the rate window — that's the whole point of the
    // filter — so the check has to precede tryConsumeCaptureSlot. The (rare)
    // race where the filter changes between this read and the reservation is
    // harmless: at worst one request is judged against a filter that is one
    // update stale.
    const existing = await this.inboxes.findByToken(inboxToken)
    if (!existing) {
      return { outcome: Outcome.INBOX_NOT_FOUND, responseConfig: null, forwardTo: null }
    }

    if (existing.captureFilter && !matchesCaptureFilter({ method, path, query, headers }, existing.captureFilter)) {
      // Allowlist miss: the inbox still responds (mock / forward / ack)
      // exactly as it would for a captured request, but nothing is persisted
      // and no slot is consumed. FILTERED carries the response config through
      // so the transport adapter's dispatch is unchanged — only the insert
      // and the counter increment are skipped.
      return {
        outcome:        Outcome.FILTERED,
        responseConfig: existing.responseConfig ?? null,
        forwardTo:      existing.forwardTo      ?? null,
      }
    }

    let inbox
    if (this.enforceLimits) {
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
      inbox = reserved.inbox
    } else {
      // Limits bypassed (local proxy mode): reuse the inbox already read
      // above. No slot is consumed, so the capture never counts against the
      // lifetime cap or the sliding rate window.
      inbox = existing
    }

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
      // Local proxy mode forwards BEFORE capturing and passes the upstream
      // response in here, so the row is inserted complete — the SSE poller
      // (cursor by id, emits each row once) then streams request + response
      // together instead of a request that never gets its response.
      upstreamResponse: upstreamResponse ?? null,
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
