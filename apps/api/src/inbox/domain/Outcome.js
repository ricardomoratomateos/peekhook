/**
 * Business outcomes for the sandbox commands:
 *   CreateInbox  → CREATED
 *   CaptureRequest → CAPTURED | INBOX_NOT_FOUND
 *   ConfigureResponse → UPDATED | CLEARED | NOT_FOUND | INVALID
 *
 * Mapping to HTTP status codes is the transport adapter's job.
 */
export const Outcome = Object.freeze({
  CREATED:          'created',
  CAPTURED:         'captured',
  INBOX_NOT_FOUND:  'inbox_not_found',
  UPDATED:          'updated',
  CLEARED:          'cleared',
  NOT_FOUND:        'not_found',
  INVALID:          'invalid',
})
