/**
 * Business outcomes for the sandbox commands:
 *
 *   CreateInbox:
 *     → CREATED
 *
 *   CaptureRequest:
 *     → CAPTURED              — request persisted, return id + responseConfig
 *     → INBOX_NOT_FOUND       — token does not resolve to a sandbox inbox
 *     → RATE_LIMITED          — sliding 60-req / 60-sec window exhausted
 *     → CAPACITY_EXCEEDED     — inbox has already accepted MAX_CAPTURE_COUNT
 *
 *   ConfigureResponse / ConfigureForward:
 *     → UPDATED | CLEARED | NOT_FOUND | INVALID
 *
 * Mapping to HTTP status codes is the transport adapter's job.
 *
 * Outcomes are plain strings (frozen) so they can live in JSON-encoded
 * error responses and test snapshots without an additional import.
 */
export const Outcome = Object.freeze({
  CREATED:           'created',
  CAPTURED:          'captured',
  INBOX_NOT_FOUND:   'inbox_not_found',
  RATE_LIMITED:      'rate_limited',
  CAPACITY_EXCEEDED: 'capacity_exceeded',
  UPDATED:           'updated',
  CLEARED:           'cleared',
  NOT_FOUND:         'not_found',
  INVALID:           'invalid',
})
