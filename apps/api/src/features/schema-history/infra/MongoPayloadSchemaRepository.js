import { PayloadSchemaRepository } from '../domain/PayloadSchemaRepository.js'
import { PayloadSchema } from '../domain/PayloadSchema.js'

/**
 * Mongo-backed PayloadSchemaRepository.
 *
 * One document per inbox, upsert by inboxToken. The doc lives in
 * `payload_schemas` and mirrors the inbox's 7-day TTL via a TTL index on
 * `expiresAt`. Reads project away the primitive fields the aggregate
 * doesn't carry (`_id`); expiry is read back as Date.
 */
export class MongoPayloadSchemaRepository extends PayloadSchemaRepository {
  constructor(db) {
    super()
    this.col = db.collection('payload_schemas')
  }

  async findByToken(inboxToken) {
    const doc = await this.col.findOne({ inboxToken }, { projection: { _id: 0 } })
    return PayloadSchema.fromDocument(doc)
  }

  /**
   * Upsert the schema for its inbox token. The caller has already attached
   * an `expiresAt`; we just write it. Unique index on inboxToken makes the
   * first race a clean retry — second writer's $set wins, which is fine for
   * idempotent field merges.
   *
   * @param {import('../domain/PayloadSchema.js').PayloadSchema} schema
   */
  async upsert(schema) {
    const doc = schema.toDocument()
    await this.col.updateOne(
      { inboxToken: doc.inboxToken },
      { $set: doc },
      { upsert: true },
    )
  }
}
