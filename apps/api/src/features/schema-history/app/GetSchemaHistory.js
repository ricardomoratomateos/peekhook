import { PayloadSchema } from '../domain/PayloadSchema.js'

/**
 * GetSchemaHistory — query side. Returns the inbox's chronological payload
 * schema history, sorted by firstSeenAt ascending so the frontend can render
 * a sparkline from oldest to newest.
 *
 * Returns an empty PayloadSchema (not null) when the inbox exists but no
 * requests have been captured. Keeping the empty case typed (always an
 * `{ inboxToken, fields: [] }` shape) lets the frontend render a calm
 * "no schema yet" state without special-casing null.
 *
 * @param {{
 *   schemas: import('../domain/PayloadSchemaRepository.js').PayloadSchemaRepository,
 * }} deps
 */
export class GetSchemaHistory {
  constructor({ schemas }) {
    this.schemas = schemas
  }

  /**
   * @param {{ inboxToken: string }} query
   * @returns {Promise<object>} `{ inboxToken, fields: [{path, type, firstSeenAt, lastSeenAt, occurrences}] }`
   */
  async execute({ inboxToken }) {
    const found = await this.schemas.findByToken(inboxToken)
    const schema = found ?? PayloadSchema.empty({ inboxToken })
    return schema.toDto()
  }
}
