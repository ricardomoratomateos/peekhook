/**
 * Outcomes for the ReplayEvent use case and the replay HTTP route.
 *
 *   REPLAYED    — replay produced a target; transport replies 200
 *   NOT_FOUND   — inbox or event not found; transport replies 404
 *   INVALID     — bad input (mockOnly!=true, missing eventId) or
 *                 unsupported replay mode; transport replies 400
 *   RATE_LIMITED — token bucket rejected; transport replies 429
 *
 * External-URL replay is intentionally absent at this MVP. The
 * mode requires inbox claim (auth), which lands in a separate
 * roadmap item. A non-mockOnly input is rejected with INVALID so
 * we never expose a code path that forwards an inbound payload to
 * the open internet from an anonymous sandbox.
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
