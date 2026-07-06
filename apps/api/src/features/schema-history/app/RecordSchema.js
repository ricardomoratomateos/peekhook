import { signatureOf } from '../domain/PayloadSignature.js'
import { PayloadSchema } from '../domain/PayloadSchema.js'

/**
 * RecordSchema — analytics command. Records the JSON shape of one captured
 * request body into the inbox's payload schema history.
 *
 * Called from CaptureRequest.execute() AFTER `requests.insert(req)` succeeds,
 * inside a try/catch in the caller so a schema-recording failure never fails
 * the user-visible capture. Mongo errors propagate; JSON parse errors are
 * intentionally swallowed here (malformed bodies are not schema material).
 *
 * Writes ONE upsert per inbox; cheap. Reads the existing schema, merges the
 * fresh observation, and writes it back. Field-level merge rules live in
 * PayloadSchema.observe() so they stay testable without Mongo.
 *
 * @param {{
 *   schemas: import('../domain/PayloadSchemaRepository.js').PayloadSchemaRepository,
 *   signatureOf?: typeof import('../domain/PayloadSignature.js').signatureOf,
 *   now?: () => Date,
 * }} deps
 */
export class RecordSchema {
  constructor({ schemas, signatureOf: walker, now }) {
    this.schemas    = schemas
    this.signatureOf = walker ?? signatureOf
    this.now        = now ?? (() => new Date())
  }

  /**
   * @param {{
   *   inboxToken: string,
   *   body: string,
   * }} cmd
   * @returns {Promise<void>}
   */
  async execute({ inboxToken, body }) {
    let entries
    try {
      entries = this.signatureOf(body ?? '')
    } catch (_err) {
      return
    }
    if (!entries || entries.length === 0) return

    const now = this.now()
    const existing = await this.schemas.findByToken(inboxToken)
    const base     = existing ?? PayloadSchema.empty({ inboxToken })

    const observed = base.observe(now, entries)
    const withTtl  = new PayloadSchema({
      inboxToken: observed.inboxToken,
      fields:     observed.fields,
      expiresAt:  PayloadSchema.computeExpiresAt(now),
    })
    await this.schemas.upsert(withTtl, { now })
  }
}
