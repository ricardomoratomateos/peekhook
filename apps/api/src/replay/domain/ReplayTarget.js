/**
 * ReplayTarget — pure DTO describing the body the replay use case
 * intends to produce. Keeping this as a value object lets the use
 * case stay free of HTTP concerns: the route handler serialises
 * the target's `status`, `contentType`, and `body` into whatever
 * surface the Inspector expects.
 *
 * Only `mock_reply` is a real `type` today; `forward_url` is a
 * placeholder for the future claim-gated external URL mode.
 */
export class ReplayTarget {
  #type
  #status
  #contentType
  #body

  constructor({ type, status, contentType, body }) {
    this.#type        = type ?? 'mock_reply'
    this.#status      = Number.isInteger(status) ? status : 200
    this.#contentType = typeof contentType === 'string' && contentType.length > 0
      ? contentType
      : 'application/json'
    this.#body        = typeof body === 'string' ? body : ''
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

  toDto() {
    return {
      type:        this.#type,
      status:      this.#status,
      contentType: this.#contentType,
      body:        this.#body,
    }
  }
}
