import { ObjectId } from 'mongodb'
import { SearchEventsRepository } from '../domain/SearchEventsRepository.js'

const DEFAULT_LIMIT = 50
const MAX_LIMIT     = 200

/**
 * Projects a `requests` document to the public CapturedRequest DTO.
 * Strips inboxToken and expiresAt (persistence concerns), and stringifies _id.
 *
 * Mirrors `MongoRequestListReadModel.toDto` exactly so the Inspector UI
 * sees the same shape regardless of whether it called `list()` or `search()`.
 */
function toDto(doc) {
  return {
    id:          doc._id.toString(),
    method:      doc.method,
    path:        doc.path,
    query:       doc.query,
    headers:     doc.headers,
    body:        doc.body,
    contentType: doc.contentType,
    size:        doc.size,
    ip:          doc.ip,
    createdAt:   doc.createdAt,
  }
}

function buildFilter({ inboxToken, regex, field }) {
  const filter = { inboxToken }
  switch (field.kind) {
    case 'path':
      filter.path = { $regex: regex, $options: 'i' }
      break
    case 'body':
      filter.body = { $regex: regex, $options: 'i' }
      break
    case 'header':
      filter[`headers.${field.name}`] = { $regex: regex, $options: 'i' }
      break
    default:
      throw new Error(`unsupported search field kind: ${field.kind}`)
  }
  return filter
}

/**
 * Mongo-backed SearchEventsRepository.
 *
 * Reads the `requests` collection with `$regex` (case-insensitive). No
 * dedicated index: per-inbox cardinality is bounded (7-day TTL + ~thousand
 * rows/day worst-case) and `$regex` on plain fields stays cheap.
 * Cursor pagination is ObjectId-based, identical to `MongoRequestListReadModel`.
 */
export class MongoRegexSearchRepository extends SearchEventsRepository {
  constructor(db) {
    super()
    this.col = db.collection('requests')
  }

  async search({ inboxToken, regex, field, limit = DEFAULT_LIMIT, before }) {
    const filter = buildFilter({ inboxToken, regex, field })
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
}
