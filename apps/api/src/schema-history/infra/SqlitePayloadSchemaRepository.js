import { PayloadSchemaRepository } from '../domain/PayloadSchemaRepository.js'
import { PayloadSchema } from '../domain/PayloadSchema.js'

/**
 * SQLite-backed PayloadSchemaRepository.
 *
 * One row per inbox, upsert by inbox_token. The full PayloadSchema
 * aggregate is serialized as JSON into `schema_json` — schema history is
 * a small dataset (one row per inbox) and we never query individual
 * fields, so the denormalized blob is the pragmatic choice. The
 * `expires_at` column mirrors the inbox's 7-day TTL so an external
 * sweeper can purge expired rows in lockstep with the inbox collection.
 */
export function migrate(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS payload_schemas (
      inbox_token TEXT PRIMARY KEY,
      schema_json TEXT NOT NULL,
      expires_at  INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_payload_schemas_expires_at
      ON payload_schemas(expires_at);
  `)
}

export class SqlitePayloadSchemaRepository extends PayloadSchemaRepository {
  #upsertStmt
  #findStmt

  constructor(db) {
    super()
    this.db = db
    this.#upsertStmt = db.prepare(`
      INSERT OR REPLACE INTO payload_schemas (inbox_token, schema_json, expires_at)
      VALUES (?, ?, ?)
    `)
    this.#findStmt = db.prepare(`
      SELECT schema_json FROM payload_schemas WHERE inbox_token = ?
    `)
  }

  async findByToken(inboxToken) {
    const row = this.#findStmt.get(inboxToken)
    if (!row) return null
    const doc = JSON.parse(row.schema_json)
    return PayloadSchema.fromDocument(doc)
  }

  /**
   * Upsert the schema for its inbox token. The aggregate's `toDocument()`
   * already carries the `expiresAt` (set by the caller), so we just
   * serialize and write. `INSERT OR REPLACE` collapses the create-vs-update
   * races into a single statement — same semantics as the Mongo
   * upsert+unique-index path.
   *
   * @param {import('../domain/PayloadSchema.js').PayloadSchema} schema
   */
  async upsert(schema) {
    const doc = schema.toDocument()
    const expiresAtMs = doc.expiresAt instanceof Date
      ? doc.expiresAt.getTime()
      : doc.expiresAt
        ? new Date(doc.expiresAt).getTime()
        : 0
    this.#upsertStmt.run(doc.inboxToken, JSON.stringify(doc), expiresAtMs)
  }
}