import crypto from 'node:crypto'

const INBOX_TTL_MS = 7 * 24 * 60 * 60 * 1000

const DEFAULT_RESPONSE = { enabled: false, status: 200, contentType: 'application/json', body: '' }
const SCRIPT_MAX_BYTES = 8 * 1024
const FORWARD_URL_MAX_BYTES = 2048

/**
 * Pure validator for sandbox response configurations, exposed so the
 * ConfigureResponse use case can validate at the boundary without needing
 * a rehydrated SandboxInbox aggregate. Throws on invalid input.
 *
 * Optional scripting fields:
 *   scriptEnabled — boolean. Defaults to false.
 *   script        — string ≤ 8 KB, only checked when present.
 */
export function validateResponseConfig(cfg) {
  if (cfg === null || cfg === undefined) return null
  if (typeof cfg.enabled !== 'boolean') throw new Error('responseConfig.enabled must be boolean')
  if (!Number.isInteger(cfg.status) || cfg.status < 100 || cfg.status > 599) throw new Error('responseConfig.status must be an integer 100–599')
  if (typeof cfg.contentType !== 'string' || cfg.contentType.length === 0) throw new Error('responseConfig.contentType must be a non-empty string')
  if (typeof cfg.body !== 'string') throw new Error('responseConfig.body must be a string')

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
 * Each inbox carries an optional responseConfig — when set, the ingest
 * route replies with the configured status / content-type / body instead
 * of the default `{ ok: true, id }` acknowledgement. This lets sandbox
 * users simulate e.g. a 503 Service Unavailable reply to test their
 * retry logic against an open webhook endpoint.
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

  constructor({ token, createdAt, expiresAt, responseConfig, forwardTo }) {
    this.#token = token
    this.#createdAt = createdAt
    this.#expiresAt = expiresAt
    this.#responseConfig = responseConfig ?? null
    this.#forwardTo = forwardTo ?? null
  }

  /**
   * Mint a new inbox. The token is 15 random bytes encoded as base64url,
   * yielding exactly 20 URL-safe characters with ~120 bits of entropy.
   *
   * @param {{ now?: Date }} opts
   * @returns {SandboxInbox}
   */
  static create({ now = new Date() } = {}) {
    const token = crypto.randomBytes(15).toString('base64url')
    const expiresAt = new Date(now.getTime() + INBOX_TTL_MS)
    return new SandboxInbox({ token, createdAt: now, expiresAt })
  }

  get token()          { return this.#token }
  get createdAt()      { return this.#createdAt }
  get expiresAt()      { return this.#expiresAt }
  get responseConfig() { return this.#responseConfig }
  get forwardTo()      { return this.#forwardTo }

  /** Snapshot for persistence. The only way state leaves the aggregate. */
  toDocument() {
    return {
      token:          this.#token,
      createdAt:      this.#createdAt,
      expiresAt:      this.#expiresAt,
      responseConfig: this.#responseConfig,
      forwardTo:      this.#forwardTo,
    }
  }
}
