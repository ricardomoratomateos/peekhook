/**
 * Fixture — pure aggregate: a realistic sample webhook payload that the
 * Inspector UI can fire into a peekhook inbox as if it were a real delivery.
 *
 * Lives in the fixtures/ subdirectory as static modules, hydrated by the
 * MemoryFixtureRepository adapter. No infra imports. The body is always a
 * pre-stringified string so the SendFixture use case can pass it through to
 * the CaptureRequest pipeline without re-encoding (mirrors how rawBody is
 * delivered by the ingest route content-type parser).
 *
 * Shape invariant — enforced by the static `create` factory so callers
 * can't accidentally ship a half-built fixture:
 *   - id        : stable identifier ("stripe.payment_intent.succeeded"). Used
 *                 as the URL segment in POST /api/inboxes/:token/fixtures/:id.
 *   - name      : full human title shown in the UI menu.
 *   - provider  : short tag ("stripe", "github", "linear", "generic").
 *   - label     : compact chip-style label for the Inspector button row.
 *   - headers   : object of HTTP headers (key lowercased). The `content-type`
 *                 entry, when present, is what CaptureRequest will record as
 *                 contentType on the captured request.
 *   - body      : JSON-encoded (or other provider-shaped) string body.
 */
export class Fixture {
  #id
  #name
  #provider
  #label
  #headers
  #body

  constructor(props) {
    this.#id       = props.id
    this.#name     = props.name
    this.#provider = props.provider
    this.#label    = props.label
    this.#headers  = props.headers
    this.#body     = props.body
  }

  /**
   * @param {{
   *   id:       string,
   *   name:     string,
   *   provider: string,
   *   label:    string,
   *   headers:  object,
   *   body:     string,
   * }} props
   * @returns {Fixture}
   */
  static create(props) {
    if (typeof props.id !== 'string' || props.id.length === 0) {
      throw new Error('id must be a non-empty string')
    }
    if (typeof props.name !== 'string' || props.name.length === 0) {
      throw new Error('name must be a non-empty string')
    }
    if (typeof props.provider !== 'string' || props.provider.length === 0) {
      throw new Error('provider must be a non-empty string')
    }
    if (typeof props.label !== 'string' || props.label.length === 0) {
      throw new Error('label must be a non-empty string')
    }
    if (!props.headers || typeof props.headers !== 'object' || Array.isArray(props.headers)) {
      throw new Error('headers must be a plain object')
    }
    if (typeof props.body !== 'string') {
      throw new Error('body must be a string (pre-stringified at module load)')
    }
    return new Fixture(props)
  }

  get id()       { return this.#id }
  get name()     { return this.#name }
  get provider() { return this.#provider }
  get label()    { return this.#label }
  get headers()  { return this.#headers }

  /** Pre-stringified body delivered verbatim to the capture pipeline. */
  get body()     { return this.#body }

  /** Byte size of the body (UTF-8). UI uses this for the "kb" indicator. */
  get bodySize() { return Buffer.byteLength(this.#body, 'utf8') }

  /** Public DTO — strips the body so listing endpoints stay light. */
  toListDto() {
    return {
      id:        this.#id,
      name:      this.#name,
      provider:  this.#provider,
      label:     this.#label,
      body_size: this.bodySize,
    }
  }
}
