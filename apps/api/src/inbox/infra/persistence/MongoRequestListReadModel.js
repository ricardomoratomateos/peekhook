import { ObjectId } from 'mongodb'
import { RequestListReadModel } from '../../domain/RequestListReadModel.js'

const DEFAULT_LIMIT = 50
const MAX_LIMIT     = 200

/**
 * Projects a `requests` document to the public CapturedRequest DTO.
 * Strips inboxToken and expiresAt (persistence concerns), and stringifies _id.
 */
function toDto(doc) {
  return {
    id:               doc._id.toString(),
    method:           doc.method,
    path:             doc.path,
    query:            doc.query,
    headers:          doc.headers,
    body:             doc.body,
    contentType:      doc.contentType,
    size:             doc.size,
    ip:               doc.ip,
    createdAt:        doc.createdAt,
    upstreamResponse: doc.upstreamResponse ?? null,
  }
}

/**
 * Mongo read model for paginated inbox request listing.
 * Reads `requests` directly; no aggregate is hydrated.
 * Cursor pagination uses ObjectId (_id), giving millisecond precision
 * and consistent ordering without a secondary sort key.
 */
export class MongoRequestListReadModel extends RequestListReadModel {
  constructor(db) {
    super()
    this.col = db.collection('requests')
  }

  async list({ inboxToken, limit = DEFAULT_LIMIT, before }) {
    const filter = { inboxToken }
    if (before && ObjectId.isValid(before)) {
      filter._id = { $lt: new ObjectId(before) }
    }

    const docs = await this.col
      .find(filter)
      .sort({ _id: -1 })
      .limit(Math.min(Number(limit) || DEFAULT_LIMIT, MAX_LIMIT))
      .toArray()

    return docs.map(toDto)
  }

  async findById({ inboxToken, id }) {
    if (!ObjectId.isValid(id)) return null
    const doc = await this.col.findOne({ _id: new ObjectId(id), inboxToken })
    return doc ? toDto(doc) : null
  }
}
