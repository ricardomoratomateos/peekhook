import { McpAuthRepository } from '../domain/McpAuthRepository.js'

/**
 * Mongo-backed McpAuthRepository.
 *
 * Stores `mcpTokenHash` on the existing `inboxes` collection — the
 * inbox token is the document key, so `setMcpTokenHash` is a partial
 * `$set` update. `findByInboxToken` projects away `_id` and returns
 * the inbox doc plus the hash.
 */
export class MongoMcpAuthRepository extends McpAuthRepository {
  constructor(db) {
    super()
    this.col = db.collection('inboxes')
  }

  async findByInboxToken(inboxToken) {
    return this.col.findOne({ token: inboxToken }, { projection: { _id: 0 } }) ?? null
  }

  async setMcpTokenHash(inboxToken, hashHex) {
    await this.col.updateOne(
      { token: inboxToken },
      { $set: { mcpTokenHash: hashHex } },
    )
  }
}
