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
    shareId:          doc.shareId ?? null,
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

  async findByShareId({ inboxToken, shareId }) {
    if (typeof shareId !== 'string' || shareId.length !== 32) return null
    const doc = await this.col.findOne({ inboxToken, shareId })
    return doc ? toDto(doc) : null
  }

  /**
   * Cursor advance for the SSE poller. `afterId === null` means
   * "no lower bound" (i.e. we want the oldest unread event from the
   * start of the stream), so the filter is built without an `_id`
   * predicate. Otherwise we constrain with `_id > ObjectId(afterId)`.
   *
   * The result is sorted ASCENDING by `_id` so the SSE handler can
   * forward events in the order they were captured. Limit defaults
   * to 20 (the SSE poll batch size) and is hard-capped at 200 so a
   * misconfigured caller cannot read the entire collection in one
   * round-trip.
   */
  async listAfter({ inboxToken, afterId, limit = 20 }) {
    const cap = Math.min(Number(limit) || 20, 200)
    const filter = { inboxToken }
    if (typeof afterId === 'string' && ObjectId.isValid(afterId)) {
      filter._id = { $gt: new ObjectId(afterId) }
    }

    const docs = await this.col
      .find(filter)
      .sort({ _id: 1 })
      .limit(cap)
      .toArray()

    return docs.map(toDto)
  }

  /**
   * Most recent capture for the inbox, projected to the DTO shape.
   * Returns null when the inbox has no captures. Used by the SSE
   * handler to seed `lastId` on connection open so the first poll
   * only emits events captured after the moment the inspector
   * loaded.
   */
  async findLatest(inboxToken) {
    const doc = await this.col
      .findOne({ inboxToken }, { sort: { _id: -1 } })
    return doc ? toDto(doc) : null
  }
}
