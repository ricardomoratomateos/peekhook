/**
 * Outcomes for the ReplayEvent use case and the replay HTTP route.
 *
 *   REPLAYED    — replay produced a target; transport replies 200
 *   NOT_FOUND   — inbox or event not found; transport replies 404
 *   INVALID     — bad input (missing eventId, malformed mutations) or
 *                 forward mode requested with no forwardTo configured;
 *                 transport replies 400
 *   RATE_LIMITED — token bucket rejected; transport replies 429
 *
 * Two replay modes are supported: `mock` (the default — replay the
 * inbox's own in-process reply) and `forward` (re-send the captured
 * request to the inbox's already-configured forwardTo). Forward mode
 * does NOT accept an arbitrary URL from the caller; it reuses the
 * pre-validated, loop-checked forwardTo that already receives the
 * inbox's live traffic, so it needs no inbox-claim gate. Arbitrary
 * external-URL replay remains unsupported.
 */
export const ReplayOutcome = Object.freeze({
  REPLAYED:     'replayed',
  NOT_FOUND:    'not_found',
  INVALID:      'invalid',
  RATE_LIMITED: 'rate_limited',
})

/**
 * Header that would be injected on the outbound replay request when
 * forwarding to an external URL. For mockOnly (the only supported
 * mode in MVP), the "recipient" is the inbox's own in-process reply,
 * so the header is surfaced in the response DTO for the Inspector
 * replay panel to render — and echoed as an HTTP response header
 * so curl smoke tests can confirm it without parsing the body.
 */
export const REPLAY_HEADER       = 'X-Peek-Replay'
export const REPLAY_HEADER_VALUE = '1'
