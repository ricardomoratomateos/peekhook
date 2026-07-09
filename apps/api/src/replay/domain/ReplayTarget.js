/**
 * ReplayTarget — pure DTO describing the result the replay use case
 * produced. Keeping this as a value object lets the use case stay free
 * of HTTP concerns: the route handler serialises the target's fields
 * into whatever surface the Inspector expects.
 *
 * Two real `type`s now:
 *   - `mock_reply`  — the inbox's own in-process reply (static, scripted,
 *                     or the default acknowledgement).
 *   - `forward_url` — the upstream response from re-sending the (possibly
 *                     mutated) captured request to the inbox's configured
 *                     `forwardTo`. This is NOT arbitrary-URL replay: the
 *                     target is the same pre-validated, loop-checked URL
 *                     that already receives this inbox's live traffic, so
 *                     it carries no new exposure over the forward feature.
 *
 * `forward_url` targets also carry `durationMs` and, on upstream
 * failure, `error` / `message`. `toDto()` only emits the optional
 * fields when they are set so mock replies keep their original shape.
 */
export class ReplayTarget {
  #type
  #status
  #contentType
  #body
  #durationMs
  #error
  #message

  constructor({ type, status, contentType, body, durationMs, error, message }) {
    this.#type        = type ?? 'mock_reply'
    this.#status      = Number.isInteger(status) ? status : 200
    this.#contentType = typeof contentType === 'string' && contentType.length > 0
      ? contentType
      : 'application/json'
    this.#body        = typeof body === 'string' ? body : ''
    this.#durationMs  = Number.isFinite(durationMs) ? durationMs : null
    this.#error       = typeof error === 'string' ? error : null
    this.#message     = typeof message === 'string' ? message : null
  }

  /** Acknowledgement-shape default — mirrors the no-config ingest path. */
  static default() {
    return new ReplayTarget({
      type:        'mock_reply',
      status:      200,
      contentType: 'application/json',
      body:        JSON.stringify({ ok: true }),
    })
  }

  /** Static reply from the inbox's stored responseConfig. */
  static fromConfig(cfg) {
    return new ReplayTarget({
      type:        'mock_reply',
      status:      cfg.status,
      contentType: cfg.contentType,
      body:        cfg.body,
    })
  }

  /** Scripted reply — keeps the configured status/contentType, swaps the body. */
  static scripted(cfg, scriptedBody) {
    return new ReplayTarget({
      type:        'mock_reply',
      status:      cfg.status,
      contentType: cfg.contentType,
      body:        scriptedBody,
    })
  }

  /**
   * Upstream response from a forward-mode replay. `fwd` is the tagged
   * result produced by the `ForwardRequest` adapter — either
   * `{ ok:true, status, contentType, body, durationMs }` or
   * `{ ok:false, error, message, durationMs }`. On failure we surface a
   * 504 (timeout) / 502 (everything else) so the Inspector badge shows
   * a meaningful status, and carry the tagged error for the detail row.
   */
  static fromForward(fwd) {
    if (fwd && fwd.ok) {
      return new ReplayTarget({
        type:        'forward_url',
        status:      fwd.status,
        contentType: fwd.contentType,
        body:        fwd.body,
        durationMs:  fwd.durationMs,
      })
    }
    const error  = fwd?.error ?? 'fetch_failed'
    const status = error === 'timeout' ? 504 : 502
    return new ReplayTarget({
      type:        'forward_url',
      status,
      contentType: 'application/json',
      body:        JSON.stringify({ error, message: fwd?.message ?? 'forward failed' }),
      durationMs:  fwd?.durationMs,
      error,
      message:     fwd?.message ?? 'forward failed',
    })
  }

  toDto() {
    const dto = {
      type:        this.#type,
      status:      this.#status,
      contentType: this.#contentType,
      body:        this.#body,
    }
    if (this.#durationMs !== null) dto.durationMs = this.#durationMs
    if (this.#error   !== null)    dto.error      = this.#error
    if (this.#message !== null)    dto.message    = this.#message
    return dto
  }
}
