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
}
