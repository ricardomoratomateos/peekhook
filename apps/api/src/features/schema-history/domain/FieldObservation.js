/**
 * FieldObservation — one slot in an inbox's payload schema history.
 *
 * A field at a given path may be observed many times over the life of an
 * inbox, occasionally with different types (e.g. `a` came in as a number
 * on the first capture, switched to a string later). Each unique
 * (path, type) pair keeps its own observation, so the sparkline can show
 * "field `a` was `number` once then `string` three times."
 *
 * Aggregate root for a single field observation. Immutable: observe()
 * calls always produce a new FieldObservation rather than mutating.
 */
export class FieldObservation {
  #path
  #type
  #firstSeenAt
  #lastSeenAt
  #occurrences

  constructor({ path, type, firstSeenAt, lastSeenAt, occurrences }) {
    this.#path        = path
    this.#type        = type
    this.#firstSeenAt = firstSeenAt
    this.#lastSeenAt  = lastSeenAt
    this.#occurrences = occurrences
  }

  /**
   * @param {{
   *   path: string,
   *   type: string,
   *   firstSeenAt: Date,
   *   lastSeenAt: Date,
   *   occurrences: number,
   * }} props
   */
  static create(props) {
    return new FieldObservation(props)
  }

  /** Composite key used for "have we seen this (path, type) before". */
  static keyOf({ path, type }) {
    return `${path}::${type}`
  }

  get path()        { return this.#path }
  get type()        { return this.#type }
  get firstSeenAt() { return this.#firstSeenAt }
  get lastSeenAt()  { return this.#lastSeenAt }
  get occurrences() { return this.#occurrences }

  toDto() {
    return {
      path:        this.#path,
      type:        this.#type,
      firstSeenAt: this.#firstSeenAt,
      lastSeenAt:  this.#lastSeenAt,
      occurrences: this.#occurrences,
    }
  }

  /** Alias for symmetry with other aggregates' toDocument(). */
  toDocument() {
    return this.toDto()
  }
}
