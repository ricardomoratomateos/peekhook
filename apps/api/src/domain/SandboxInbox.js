import crypto from 'node:crypto'

const INBOX_TTL_MS = 7 * 24 * 60 * 60 * 1000

const DEFAULT_RESPONSE = { enabled: false, status: 200, contentType: 'application/json', body: '' }

/**
 * Pure validator for sandbox response configurations, exposed so the
 * ConfigureResponse use case can validate at the boundary without needing
 * a rehydrated SandboxInbox aggregate. Throws on invalid input.
 */
export function validateResponseConfig(cfg) {
  if (cfg === null || cfg === undefined) return null
  if (typeof cfg.enabled !== 'boolean') throw new Error('responseConfig.enabled must be boolean')
  if (!Number.isInteger(cfg.status) || cfg.status < 100 || cfg.status > 599) throw new Error('responseConfig.status must be an integer 100–599')
  if (typeof cfg.contentType !== 'string' || cfg.contentType.length === 0) throw new Error('responseConfig.contentType must be a non-empty string')
  if (typeof cfg.body !== 'string') throw new Error('responseConfig.body must be a string')
  return { ...DEFAULT_RESPONSE, ...cfg }
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

  constructor({ token, createdAt, expiresAt, responseConfig }) {
    this.#token = token
    this.#createdAt = createdAt
    this.#expiresAt = expiresAt
    this.#responseConfig = responseConfig ?? null
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

  /** Snapshot for persistence. The only way state leaves the aggregate. */
  toDocument() {
    return {
      token:          this.#token,
      createdAt:      this.#createdAt,
      expiresAt:      this.#expiresAt,
      responseConfig: this.#responseConfig,
    }
  }
}
