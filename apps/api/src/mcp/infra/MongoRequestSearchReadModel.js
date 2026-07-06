import { RequestSearchReadModel } from '../domain/RequestSearchReadModel.js'

const DEFAULT_LIMIT = 50

/**
 * Mongo-backed RequestSearchReadModel.
 *
 * Reads `requests` directly with `$regex` (case-insensitive). Limit
 * capped at 50 — a 7-day inbox only generates a few hundred events
 * and `$regex` queries on plain fields are cheap. Uses the same DTO
 * projection shape as `MongoRequestListReadModel` so callers see a
 * consistent capture-record format across tools.
 */
export class MongoRequestSearchReadModel extends RequestSearchReadModel {
  constructor(db) {
    super()
    this.col = db.collection('requests')
  }

  async search({ inboxToken, regex, field, headerKey, limit = DEFAULT_LIMIT }) {
    const filter = buildFilter({ inboxToken, regex, field, headerKey })
    const docs = await this.col
      .find(filter)
      .sort({ _id: -1 })
      .limit(Math.min(Number(limit) || DEFAULT_LIMIT, DEFAULT_LIMIT))
      .toArray()
    return docs.map(toDto)
  }
}

function buildFilter({ inboxToken, regex, field, headerKey }) {
  const filter = { inboxToken }
  switch (field) {
    case 'path':
      filter.path = { $regex: regex, $options: 'i' }
      break
    case 'header': {
      if (typeof headerKey !== 'string' || headerKey.length === 0) {
        throw new Error('headerKey required when field is "header"')
      }
      filter[`headers.${headerKey}`] = { $regex: regex, $options: 'i' }
      break
    }
    case 'body':
      filter.body = { $regex: regex, $options: 'i' }
      break
    default:
      throw new Error(`field must be one of "path", "header", "body"`)
  }
  return filter
}

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
