import { FieldObservation } from './FieldObservation.js'

const INBOX_TTL_MS = 7 * 24 * 60 * 60 * 1000

function sortFieldsByFirstSeen(fields) {
  return fields.slice().sort((a, b) => a.firstSeenAt.getTime() - b.firstSeenAt.getTime())
}

/**
 * PayloadSchema — one inbox's evolving field schema history.
 *
 * Holds the ordered list of FieldObservation slots for a single inbox
 * token, with the merge logic that turns a fresh observation into either
 * a counter bump on an existing slot or a brand-new slot.
 *
 * Aggregate root. The construction shape is unchanged from persistence;
 * `fromDocument()` rebuilds an aggregate from a Mongo doc, `toDocument()`
 * flattens it back. `observe()` is the only mutation, and it returns a
 * NEW PayloadSchema — immutability keeps the use case trivial and makes
 * the merge order testable.
 */
export class PayloadSchema {
  #inboxToken
  #fields
  #expiresAt

  constructor({ inboxToken, fields, expiresAt }) {
    this.#inboxToken = inboxToken
    this.#fields     = sortFieldsByFirstSeen(fields ?? [])
    this.#expiresAt  = expiresAt ?? null
  }

  /** Empty schema for a freshly-created inbox (no captures yet). */
  static empty({ inboxToken }) {
    return new PayloadSchema({ inboxToken, fields: [], expiresAt: null })
  }

  /** Rehydrate from a Mongo document (one doc per inbox, upsert pattern). */
  static fromDocument(doc) {
    if (!doc) return null
    const fields = (doc.fields ?? []).map((f) => FieldObservation.create({
      path:        f.path,
      type:        f.type,
      firstSeenAt: f.firstSeenAt instanceof Date ? f.firstSeenAt : new Date(f.firstSeenAt),
      lastSeenAt:  f.lastSeenAt instanceof Date  ? f.lastSeenAt  : new Date(f.lastSeenAt),
      occurrences: Number(f.occurrences) || 0,
    }))
    return new PayloadSchema({
      inboxToken: doc.inboxToken,
      fields,
      expiresAt: doc.expiresAt ?? null,
    })
  }

  static create({ inboxToken, fields = [], expiresAt = null }) {
    return new PayloadSchema({ inboxToken, fields, expiresAt })
  }

  get inboxToken() { return this.#inboxToken }
  get fields()     { return this.#fields.slice() }
  get expiresAt()  { return this.#expiresAt }

  /**
   * Merge a fresh signature (one or more `{ path, type }` entries) into the
   * schema. For each entry:
   *   - if (path, type) already exists → increment occurrences, bump lastSeenAt
   *   - otherwise → append a new FieldObservation with firstSeenAt=lastSeenAt=now
   *
   * Returns a NEW PayloadSchema. The sort-by-firstSeenAt is applied at the
   * end so chronological reads stay stable even as new observation slots
   * arrive between older ones (e.g. type switch on a pre-existing field).
   *
   * @param {Date} now
   * @param {{ path: string, type: string }[]} signatureEntries
   * @returns {PayloadSchema}
   */
  observe(now, signatureEntries) {
    if (!Array.isArray(signatureEntries) || signatureEntries.length === 0) {
      return new PayloadSchema({
        inboxToken: this.#inboxToken,
        fields:     this.#fields.slice(),
        expiresAt:  this.#expiresAt,
      })
    }

    const byKey = new Map()
    const merged = []
    for (const f of this.#fields) {
      byKey.set(FieldObservation.keyOf(f), f)
      merged.push(f)
    }

    for (const entry of signatureEntries) {
      const key = FieldObservation.keyOf(entry)
      const existing = byKey.get(key)
      if (existing) {
        const bumped = FieldObservation.create({
          path:        existing.path,
          type:        existing.type,
          firstSeenAt: existing.firstSeenAt,
          lastSeenAt:  now,
          occurrences: existing.occurrences + 1,
        })
        const idx = merged.indexOf(existing)
        merged[idx] = bumped
        byKey.set(key, bumped)
      } else {
        const obs = FieldObservation.create({
          path:        entry.path,
          type:        entry.type,
          firstSeenAt: now,
          lastSeenAt:  now,
          occurrences: 1,
        })
        merged.push(obs)
        byKey.set(key, obs)
      }
    }

    merged.sort((a, b) => a.firstSeenAt.getTime() - b.firstSeenAt.getTime())

    return new PayloadSchema({
      inboxToken: this.#inboxToken,
      fields:     merged,
      expiresAt:  this.#expiresAt,
    })
  }

  /** Snapshot for persistence: the inboxToken, the field list, and the TTL. */
  toDocument() {
    return {
      inboxToken: this.#inboxToken,
      fields:     this.#fields.map((f) => f.toDocument()),
      expiresAt:  this.#expiresAt,
    }
  }

  /** Public DTO for the /schema-history endpoint. */
  toDto() {
    return {
      inboxToken: this.#inboxToken,
      fields:     this.#fields.map((f) => f.toDto()),
    }
  }

  /** 7-day TTL, in lockstep with the inbox collection's TTL. */
  static computeExpiresAt(now) {
    return new Date(now.getTime() + INBOX_TTL_MS)
  }
}
