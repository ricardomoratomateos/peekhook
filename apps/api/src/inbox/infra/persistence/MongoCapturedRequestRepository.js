import crypto from 'node:crypto'
import { ObjectId } from 'mongodb'
import { CapturedRequestRepository } from '../../domain/CapturedRequestRepository.js'

/**
 * Mongo-backed CapturedRequestRepository.
 * Uses ObjectId as the native _id so the SSE poller can use _id > lastId
 * cursor pagination without a separate createdAt comparison.
 */
export class MongoCapturedRequestRepository extends CapturedRequestRepository {
  constructor(db) {
    super()
    this.col = db.collection('requests')
  }

  nextId() {
    return new ObjectId()
  }

  async insert(req) {
    await this.col.insertOne(req.toDocument())
  }

  async updateUpstreamResponse(id, upstream) {
    if (!ObjectId.isValid(id)) return
    await this.col.updateOne(
      { _id: new ObjectId(id) },
      { $set: { upstreamResponse: upstream } },
    )
  }

  /**
   * Idempotently mint a 16-byte (32 hex chars) shareId and attach it
   * to the captured request. Scoped by inboxToken so a caller can only
   * mint a share for their own captures. If a shareId already exists,
   * the existing value is returned without mutation.
   */
  async upsertShareId(id, inboxToken) {
    if (!ObjectId.isValid(id)) return null
    const existing = await this.col.findOne(
      { _id: new ObjectId(id), inboxToken },
      { projection: { shareId: 1 } },
    )
    if (!existing) return null
    if (typeof existing.shareId === 'string' && existing.shareId.length === 32) {
      return existing.shareId
    }
    const shareId = crypto.randomBytes(16).toString('hex')
    await this.col.updateOne(
      { _id: new ObjectId(id), inboxToken, shareId: { $in: [null, undefined] } },
      { $set: { shareId } },
    )
    const fresh = await this.col.findOne(
      { _id: new ObjectId(id), inboxToken },
      { projection: { shareId: 1 } },
    )
    return fresh?.shareId ?? shareId
  }
}
