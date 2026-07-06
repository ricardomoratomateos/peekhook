import { InboxRepository } from '../../domain/InboxRepository.js'

/**
 * Mongo-backed InboxRepository.
 * The token is the document key (stored as `token`, unique-indexed).
 */
export class MongoInboxRepository extends InboxRepository {
  constructor(db) {
    super()
    this.col = db.collection('inboxes')
  }

  async findByToken(token) {
    return this.col.findOne({ token }, { projection: { _id: 0 } }) ?? null
  }

  async insert(inbox) {
    await this.col.insertOne(inbox.toDocument())
  }

  async updateResponseConfig(token, responseConfig) {
    await this.col.updateOne(
      { token },
      { $set: { responseConfig } },
    )
  }
}
