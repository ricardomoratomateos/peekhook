/**
 * CapturedRequest aggregate.
 *
 * A single HTTP request received by a sandbox inbox. Captures everything the
 * caller sent — method, path, query, headers, raw body, and client IP — so
 * the developer can inspect it in the UI, just like webhook.site.
 *
 * expiresAt is inherited from the parent SandboxInbox so all records for an
 * inbox expire together. toDocument() maps to the `requests` schema.
 * toDto() produces the public-facing read projection (no inboxToken, no TTL).
 *
 * `shareId` is a separate, opt-in 16-byte hex token minted when the user
 * clicks "share" on a capture. It is the ONLY id that may appear in a
 * public share URL — the Mongo ObjectId is never exposed. Old captures
 * captured before this field existed carry `shareId = null` and are
 * unreadable via the public share endpoint.
 */
export class CapturedRequest {
  #id
  #inboxToken
  #method
  #path
  #query
  #headers
  #body
  #contentType
  #size
  #ip
  #createdAt
  #expiresAt
  #upstreamResponse
  #shareId

  constructor(props) {
    this.#id               = props.id
    this.#inboxToken       = props.inboxToken
    this.#method           = props.method
    this.#path             = props.path
    this.#query            = props.query
    this.#headers          = props.headers
    this.#body             = props.body
    this.#contentType      = props.contentType
    this.#size             = props.size
    this.#ip               = props.ip
    this.#createdAt        = props.createdAt
    this.#expiresAt        = props.expiresAt
    this.#upstreamResponse = props.upstreamResponse ?? null
    this.#shareId          = props.shareId ?? null
  }

  /**
   * @param {{
   *   id: *,
   *   inboxToken: string,
   *   method: string,
   *   path: string,
   *   query: object,
   *   headers: object,
   *   body: string,
   *   contentType: string,
   *   size: number,
   *   ip: string,
   *   now: Date,
   *   expiresAt: Date,
   *   upstreamResponse?: object | null,
   *   shareId?: string | null,
   * }} props
   */
  static create(props) {
    return new CapturedRequest({
      id:               props.id,
      inboxToken:       props.inboxToken,
      method:           props.method,
      path:             props.path,
      query:            props.query,
      headers:          props.headers,
      body:             props.body,
      contentType:      props.contentType,
      size:             props.size,
      ip:               props.ip,
      createdAt:        props.now,
      expiresAt:        props.expiresAt,
      upstreamResponse: props.upstreamResponse ?? null,
      shareId:          props.shareId ?? null,
    })
  }

  get id() { return this.#id }
  get shareId() { return this.#shareId }

  /** Snapshot for persistence. */
  toDocument() {
    return {
      _id:              this.#id,
      inboxToken:       this.#inboxToken,
      method:           this.#method,
      path:             this.#path,
      query:            this.#query,
      headers:          this.#headers,
      body:             this.#body,
      contentType:      this.#contentType,
      size:             this.#size,
      ip:               this.#ip,
      createdAt:        this.#createdAt,
      expiresAt:        this.#expiresAt,
      upstreamResponse: this.#upstreamResponse,
      shareId:          this.#shareId,
    }
  }

  /** Public DTO — strips persistence fields (inboxToken, expiresAt). */
  toDto() {
    return {
      id:               this.#id.toString(),
      method:           this.#method,
      path:             this.#path,
      query:            this.#query,
      headers:          this.#headers,
      body:             this.#body,
      contentType:      this.#contentType,
      size:             this.#size,
      ip:               this.#ip,
      createdAt:        this.#createdAt,
      upstreamResponse: this.#upstreamResponse,
      shareId:          this.#shareId,
    }
  }
}
