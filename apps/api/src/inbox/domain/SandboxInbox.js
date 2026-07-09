import crypto from 'node:crypto'

const INBOX_TTL_MS = 7 * 24 * 60 * 60 * 1000

const DEFAULT_RESPONSE = { enabled: false, status: 200, contentType: 'application/json', body: '', delayMs: 0 }
const SCRIPT_MAX_BYTES = 8 * 1024
const FORWARD_URL_MAX_BYTES = 2048

/**
 * Upper bound on the artificial delay a mock reply may hold before it
 * responds. Lets a sandbox user simulate a slow / timing-out upstream
 * to exercise their client's timeout + retry logic. Capped at 30s so a
 * misconfigured inbox can't pin a request handler open indefinitely —
 * 30s is already past every default HTTP client timeout, so it covers
 * the "upstream never answers in time" case without a true hang.
 */
export const MAX_MOCK_DELAY_MS = 30_000

/**
 * Hard caps enforced on the *configured* mock-reply body. ROADMAP
 * "Mock body cap: 64 KB" — the user-supplied body that gets returned
 * for every captured request is capped so a misconfigured sandbox
 * can't blast gigabytes per request into the response stream.
 *
 * The cap is on the configured body, NOT on the captured request
 * body (which is separately capped at 1 MB by the ingest route's
 * `bodyLimit` + gzip-bomb defense). 64 KB is well above what any
 * realistic webhook handler needs to send back, and matches the
 * response body ceiling the inspector already assumes.
 */
export const MOCK_BODY_MAX_BYTES = 64 * 1024

/**
 * Allowlist of `content-type` values the mock-reply route will accept.
 * Anything outside this set is rejected at config time with 400.
 *
 * Rationale: `text/plain`, `application/json`, `application/xml`, and
 * `text/html` are the four content-types a developer realistically
 * wants to return from a webhook mock. Adding `application/octet-stream`
 * would let an attacker serve an arbitrary binary body and force the
 * browser to render / download whatever they uploaded; `text/javascript`
 * would let an attacker serve live script to anyone hitting the mock
 * inbox URL (which is the public, unauthenticated `/i/:token` surface).
 *
 * Returns from the inspector's `toDto()` are still the unmodified
 * JSON the caller sent; this allowlist only constrains the mock
 * reply's `content-type` header value, not the captured content-types
 * we display in the inspector feed.
 */
export const ALLOWED_MOCK_CONTENT_TYPES = Object.freeze([
  'text/plain',
  'application/json',
  'application/xml',
  'text/html',
])

/**
 * Hard caps enforced on `/i/:token` captures. Documented in `ROADMAP.md`
 * under "Security limits (reception + sending)":
 *
 *   - `MAX_CAPTURE_COUNT` (item 7 / "Per-inbox request cap: 1,000") — after
 *     1,000 successful captures over the lifetime of the inbox, further
 *     POST/PUT/PATCH/DELETE requests return 429. Existing captures stay
 *     readable; the user can mint a new inbox to continue. The counter is
 *     persisted on the inbox aggregate as `captureCount` and incremented
 *     atomically by the capture use case / repository.
 *
 *   - `RATE_LIMIT_WINDOW_MS` and `RATE_LIMIT_MAX_REQUESTS` (item 2 / "Rate
 *     limit per token: 60 req/min") — sliding 60-second window per inbox
 *     token. After 60 captures within any 60s window, the next request
 *     returns 429 with a `Retry-After` header (seconds until the window
 *     frees). The window state is persisted on the inbox aggregate as
 *     `rateWindow = { startedAt, count }` and updated atomically by the
 *     capture use case / repository.
 *
 * Both caps live on the same aggregate so the inbox itself remains the
 * source of truth — no separate "rate limit" collection, no in-process
 * state that disappears on restart. Restart-resilience is explicit
 * (sliding window survives process restart because it's in Mongo) and
 * the design carries across horizontal scaling (multiple API replicas
 * share the same Mongo and see the same counter).
 */
export const MAX_CAPTURE_COUNT = 1000
export const RATE_LIMIT_WINDOW_MS = 60_000
export const RATE_LIMIT_MAX_REQUESTS = 60

/**
 * Pure validator for sandbox response configurations, exposed so the
 * ConfigureResponse use case can validate at the boundary without needing
 * a rehydrated SandboxInbox aggregate. Throws on invalid input.
 *
 * Optional scripting fields:
 *   scriptEnabled — boolean. Defaults to false.
 *   script        — string ≤ 8 KB, only checked when present.
 *
 * Security checks layered on top of the shape validation:
 *   - `contentType` MUST be in `ALLOWED_MOCK_CONTENT_TYPES` (no
 *     `application/javascript`, no `text/css`, no `application/octet-stream`).
 *   - `contentType` MUST NOT contain CR or LF — Fastify's
 *     `reply.header()` does throw `ERR_INVALID_CHAR` at response time
 *     on Node 20+, but only AFTER the capture has been persisted.
 *     Rejecting at config time turns a 500-mid-stream into a clean
 *     400-with-message and avoids persisting a malicious config.
 *   - `body` byte length MUST be ≤ `MOCK_BODY_MAX_BYTES`. Enforced
 *     here so the cap lives next to the rest of the response-config
 *     rule set rather than scattered between validator and route.
 */
export function validateResponseConfig(cfg) {
  if (cfg === null || cfg === undefined) return null
  if (typeof cfg.enabled !== 'boolean') throw new Error('responseConfig.enabled must be boolean')
  if (!Number.isInteger(cfg.status) || cfg.status < 100 || cfg.status > 599) throw new Error('responseConfig.status must be an integer 100–599')
  if (typeof cfg.contentType !== 'string' || cfg.contentType.length === 0) throw new Error('responseConfig.contentType must be a non-empty string')
  if (cfg.contentType.includes('\r') || cfg.contentType.includes('\n')) {
    throw new Error('responseConfig.contentType must not contain CR or LF characters')
  }
  if (!ALLOWED_MOCK_CONTENT_TYPES.includes(cfg.contentType)) {
    throw new Error(`responseConfig.contentType must be one of: ${ALLOWED_MOCK_CONTENT_TYPES.join(', ')}`)
  }
  if (typeof cfg.body !== 'string') throw new Error('responseConfig.body must be a string')
  if (Buffer.byteLength(cfg.body, 'utf8') > MOCK_BODY_MAX_BYTES) {
    throw new Error(`responseConfig.body exceeds ${MOCK_BODY_MAX_BYTES} byte limit`)
  }

  if (cfg.delayMs !== undefined && cfg.delayMs !== null) {
    if (!Number.isInteger(cfg.delayMs) || cfg.delayMs < 0 || cfg.delayMs > MAX_MOCK_DELAY_MS) {
      throw new Error(`responseConfig.delayMs must be an integer 0–${MAX_MOCK_DELAY_MS}`)
    }
  }

  if (cfg.scriptEnabled !== undefined && typeof cfg.scriptEnabled !== 'boolean') {
    throw new Error('responseConfig.scriptEnabled must be boolean when present')
  }
  if (cfg.script !== undefined && cfg.script !== null) {
    if (typeof cfg.script !== 'string') throw new Error('responseConfig.script must be a string when present')
    if (Buffer.byteLength(cfg.script, 'utf8') > SCRIPT_MAX_BYTES) {
      throw new Error('responseConfig.script exceeds 8 KB limit')
    }
  }

  return { ...DEFAULT_RESPONSE, ...cfg }
}

/**
 * Validate a `forwardTo` URL. Returns the normalised URL string, or `null`
 * when the caller passes null/undefined (clear). Throws on anything else.
 *
 *   - Must be a string (or nullish).
 *   - Must parse with the WHATWG URL parser.
 *   - Protocol must be http: or https:.
 *   - Total byte length capped (defensive).
 *
 * Does NOT enforce a public-IP allowlist — the whole point of this feature
 * is to forward to localhost / private dev servers. Loop protection is a
 * separate concern, handled at forward time against the public ingest URL.
 */
export function validateForwardUrl(raw) {
  if (raw === null || raw === undefined) return null
  if (typeof raw !== 'string') throw new Error('forwardTo must be a string')
  if (raw.length === 0) throw new Error('forwardTo must be a non-empty string')
  if (Buffer.byteLength(raw, 'utf8') > FORWARD_URL_MAX_BYTES) {
    throw new Error(`forwardTo exceeds ${FORWARD_URL_MAX_BYTES} byte limit`)
  }
  let parsed
  try {
    parsed = new URL(raw)
  } catch (_err) {
    throw new Error('forwardTo must be a valid http(s) URL')
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('forwardTo protocol must be http: or https:')
  }
  return raw
}

/**
 * SandboxInbox aggregate.
 *
 * An ephemeral webhook inbox, identified by a URL-safe random token.
 * The token IS the public identifier — no numeric or ObjectId-based key.
 * TTL is fixed at 7 days; the repository persists a MongoDB TTL index on
 * expiresAt so MongoDB handles cleanup automatically.
 *
 * Each inbox carries:
 *   - optional responseConfig — when set, the ingest route replies with
 *     the configured status / content-type / body instead of the default
 *     `{ ok: true, id }` acknowledgement. Lets sandbox users simulate
 *     e.g. a 503 Service Unavailable reply to test their retry logic
 *     against an open webhook endpoint.
 *   - optional forwardTo — when set, the ingest route proxies the captured
 *     request out to that URL and returns the upstream response. Loop
 *     protection (no recursion into `/i/...` on the same origin) is
 *     enforced at both config time and forward time.
 *   - captureCount — running counter of accepted captures, used by the
 *     1,000-per-inbox lifetime cap (ROADMAP "Per-inbox request cap").
 *   - rateWindow — sliding 60-second window used by the 60/min per-token
 *     rate limit (ROADMAP "Rate limit per token"). `{ startedAt: Date,
 *     count: number }`. Reset when the window expires.
 *   - mockBodySize — UTF-8 byte size of the *configured* mock-reply
 *     body, used by the ROADMAP "Mock body cap: 64 KB" item. The use
 *     case that sets the mock reply (`ConfigureResponse`) writes this
 *     field via the repository after `validateResponseConfig` accepts
 *     the payload. `0` while no reply is configured or while the reply
 *     body is the empty string.
 *
 * Invariants:
 *   - `captureCount >= 0`. After 1,000 successful captures, the capture
 *     endpoint must return 429 regardless of window state, and the inbox
 *     stays in that state forever (it's a lifetime cap, not a quota).
 *     Mint a new inbox to continue.
 *   - `rateWindow.count >= 0` and `rateWindow.count <= 60`. The capture
 *     endpoint returns 429 + `Retry-After` when 60 requests have been
 *     accepted within any rolling 60-second window. The window resets
 *     (count → 1) when `now - rateWindow.startedAt > 60_000ms`.
 *   - `mockBodySize >= 0` and `mockBodySize <= MOCK_BODY_MAX_BYTES`.
 *     The cap is enforced at the boundary (`validateResponseConfig`),
 *     and the aggregate carries the persisted value so inspectors /
 *     audit log readers can see the current configured size without
 *     re-reading `responseConfig.body`.
 *   - Both `captureCount` and `rateWindow` fields are only mutated on
 *     a SUCCESSFUL capture (i.e., after the request body / headers
 *     pass validation and the inbox has passed the rate + capacity
 *     checks). Failed captures do NOT consume capacity or rate budget.
 *
 * Static factory mints the token so the aggregate always starts in a valid
 * state. toDocument() is the only way state leaves the aggregate.
 */
export class SandboxInbox {
  #token
  #createdAt
  #expiresAt
  #responseConfig
  #forwardTo
  #captureCount
  #rateWindow
  #mockBodySize

  constructor({ token, createdAt, expiresAt, responseConfig, forwardTo, captureCount, rateWindow, mockBodySize }) {
    this.#token = token
    this.#createdAt = createdAt
    this.#expiresAt = expiresAt
    this.#responseConfig = responseConfig ?? null
    this.#forwardTo = forwardTo ?? null
    this.#captureCount = captureCount ?? 0
    this.#rateWindow = rateWindow ?? { startedAt: null, count: 0 }
    this.#mockBodySize = mockBodySize ?? 0
    if (this.#rateWindow.startedAt !== null && !(this.#rateWindow.startedAt instanceof Date)) {
      this.#rateWindow.startedAt = new Date(this.#rateWindow.startedAt)
    }
  }

  /**
   * Mint a new inbox. The token is 15 random bytes encoded as base64url,
   * yielding exactly 20 URL-safe characters with ~120 bits of entropy.
   *
   * @param {{
   *   now?: Date,
   *   captureCount?: number,
   *   rateWindow?: { startedAt: Date | null, count: number },
   *   mockBodySize?: number,
   * }} opts
   * @returns {SandboxInbox}
   */
  static create({ now = new Date(), captureCount = 0, rateWindow, mockBodySize = 0 } = {}) {
    const token = crypto.randomBytes(15).toString('base64url')
    const expiresAt = new Date(now.getTime() + INBOX_TTL_MS)
    return new SandboxInbox({
      token,
      createdAt: now,
      expiresAt,
      captureCount,
      rateWindow: rateWindow ?? { startedAt: null, count: 0 },
      mockBodySize,
    })
  }

  get token()          { return this.#token }
  get createdAt()      { return this.#createdAt }
  get expiresAt()      { return this.#expiresAt }
  get responseConfig() { return this.#responseConfig }
  get forwardTo()      { return this.#forwardTo }
  get captureCount()   { return this.#captureCount }
  get rateWindow()     { return { startedAt: this.#rateWindow.startedAt, count: this.#rateWindow.count } }
  /**
   * UTF-8 byte size of the configured mock-reply body. `0` when no
   * mock reply is configured (or its body is the empty string).
   */
  get mockBodySize()   { return this.#mockBodySize }

  /** Snapshot for persistence. The only way state leaves the aggregate. */
  toDocument() {
    return {
      token:          this.#token,
      createdAt:      this.#createdAt,
      expiresAt:      this.#expiresAt,
      responseConfig: this.#responseConfig,
      forwardTo:      this.#forwardTo,
      captureCount:   this.#captureCount,
      rateWindow:     this.#rateWindow,
      mockBodySize:   this.#mockBodySize,
    }
  }
}
