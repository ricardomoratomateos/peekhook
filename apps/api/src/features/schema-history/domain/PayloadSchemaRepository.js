/**
 * Port: persistence boundary for PayloadSchema aggregates (one doc per
 * inbox, upsert by inboxToken). Implemented by infra (MongoPayloadSchemaRepository)
 * and by test fakes. Use cases take the implementation via constructor.
 */
export class PayloadSchemaRepository {
  /**
   * @param {string} inboxToken
   * @returns {Promise<object|null>} hydrated PayloadSchema, or null if no
   *   schema has been recorded for the inbox yet.
   */
  async findByToken(inboxToken) {
    throw new Error('PayloadSchemaRepository.findByToken not implemented')
  }

  /**
   * Upsert a PayloadSchema for its inboxToken. Implementations must set the
   * TTL field so the doc expires in lockstep with the inbox.
   *
   * @param {import('./PayloadSchema.js').PayloadSchema} schema
   * @param {{ now?: Date }} [opts]
   * @returns {Promise<void>}
   */
  async upsert(schema, opts) {
    throw new Error('PayloadSchemaRepository.upsert not implemented')
  }
}
