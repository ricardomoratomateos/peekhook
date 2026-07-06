/**
 * get_event tool handler.
 *
 * Returns a single DTO with `body` decoded as parsed JSON when the
 * content-type is `application/json` (or has `+json` suffix). For
 * every other content-type the body stays a raw string so binary or
 * form-encoded payloads are preserved verbatim.
 */
export class GetEventTool {
  constructor({ readModel }) {
    this.readModel = readModel
  }

  /**
   * @param {{ inbox_token: string, event_id: string }} args
   * @returns {Promise<null | {
   *   id: string,
   *   method: string,
   *   path: string,
   *   query: object,
   *   headers: object,
   *   body: string | object,
   *   contentType: string,
   *   size: number,
   *   ip: string,
   *   createdAt: Date,
   * }>}
   */
  async execute({ inbox_token, event_id }) {
    const dto = await this.readModel.findById({ inboxToken: inbox_token, id: event_id })
    if (!dto) return null
    return { ...dto, body: decodeBody(dto.body, dto.contentType) }
  }
}

/**
 * If `contentType` indicates JSON, attempt to parse `body` as JSON.
 * On parse failure, return the original string so the caller still
 * sees something useful rather than an opaque parse error.
 */
function decodeBody(body, contentType) {
  if (typeof body !== 'string') return body
  if (!isJsonContentType(contentType)) return body
  try { return JSON.parse(body) } catch { return body }
}

function isJsonContentType(ct) {
  if (typeof ct !== 'string') return false
  const lower = ct.toLowerCase()
  return lower.includes('application/json') || lower.includes('+json')
}
