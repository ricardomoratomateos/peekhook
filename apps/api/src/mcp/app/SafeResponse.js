/**
 * Prompt-injection-safe response projections.
 *
 * Goal: an AI consuming a tool's response should not be tricked into
 * reading a poisoned webhook body verbatim and then calling
 * `list_events` / `get_event` to exfiltrate. We achieve this by:
 *
 *   - never returning the raw `body` field of a captured event,
 *   - extracting top-level body fields into a structured map,
 *   - capping every string body field at BODY_FIELD_CAP_BYTES,
 *   - marking every returned body-derived value with
 *     `userControlled: true` so an LLM downstream is structurally
 *     warned that the content came from an untrusted source.
 *
 * `explain_event` already returns a structured summary (provider,
 * summary, fields) and does not need wrapping. `list_events` returns
 * DTOs without bodies (the read model strips them) and does not need
 * wrapping. `get_event` is the one tool that may legitimately need
 * the full body — it accepts an `includeBody: boolean` argument,
 * default `false`, that opts in.
 */

export const BODY_FIELD_CAP_BYTES = 1024

/**
 * @param {object | null} dto  Captured request DTO (body, headers, …)
 * @param {{ includeBody?: boolean }} [opts]
 * @returns {object | null}
 */
export function safeEvent(dto, opts = {}) {
  if (!dto || typeof dto !== 'object') return null
  const {
    id, method, path, query = {}, headers = {},
    contentType, size, ip, createdAt, body,
  } = dto
  const includeBody = opts.includeBody === true

  const out = {
    id,
    method,
    path,
    query,
    contentType: contentType ?? null,
    size,
    ip,
    createdAt,
    headers:      redactHeaders(headers),
    bodyFields:   topLevelBodyFields(body, contentType),
    bodyIncluded: includeBody,
  }

  if (includeBody) {
    out.body = wrapIncludeBody(body)
  }
  return out
}

function redactHeaders(headers) {
  if (!headers || typeof headers !== 'object') return {}
  const out = {}
  for (const [k, v] of Object.entries(headers)) {
    if (Array.isArray(v)) {
      out[k] = v.map((entry) => wrapUserString(entry))
    } else {
      out[k] = wrapUserString(v)
    }
  }
  return out
}

/**
 * Reduce a captured body to its top-level fields. Each value is
 * wrapped so the consumer cannot confuse it for system data:
 *   - object → { value, userControlled: true }
 *   - object whose serialised form exceeds the cap
 *     → { length, userControlled: true, truncated: true }
 * Non-JSON bodies (or scalar JSON like `"hello"`, `42`, `true`) fall
 * back to a `_scalar` field with the same shape so the LLM still
 * sees the length without seeing the content.
 *
 * `body` may arrive either as a string (raw, search/list path) or as
 * an already-parsed object (get_event path, which decodes JSON).
 * Both shapes are handled here.
 */
function topLevelBodyFields(body, contentType) {
  if (body === null || body === undefined) {
    return { _missing: { userControlled: true, present: false } }
  }
  if (typeof body !== 'string') {
    return extractFromObject(body)
  }
  if (!isJsonContentType(contentType)) {
    return wrapNonJson(body, contentType)
  }
  let parsed
  try { parsed = JSON.parse(body) } catch { return wrapNonJson(body, contentType) }
  return extractFromObject(parsed)
}

function extractFromObject(value) {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const out = {}
    for (const [k, v] of Object.entries(value)) {
      out[k] = wrapValue(v)
    }
    return out
  }
  // JSON scalar / array — represent as a single length-bearing field.
  const serialised = typeof value === 'string' ? value : JSON.stringify(value)
  return {
    _scalar: {
      userControlled: true,
      truncated:       serialised.length > BODY_FIELD_CAP_BYTES,
      length:          serialised.length,
    },
  }
}

function wrapNonJson(body, contentType) {
  // Non-JSON bodies have no field structure to extract. Treat the
  // entire body as opaque user input and surface only the metadata
  // — length, content-type, and a userControlled marker. The raw
  // value never appears in the response unless the caller explicitly
  // opts in via `includeBody: true` (in which case `out.body` carries
  // the wrapped value, not `bodyFields._raw`).
  return {
    _raw: {
      userControlled: true,
      contentType:    contentType ?? null,
      length:         body.length,
      truncated:      body.length > BODY_FIELD_CAP_BYTES,
    },
  }
}

function wrapValue(v) {
  if (v === null || v === undefined) {
    return { value: v, userControlled: true }
  }
  if (typeof v === 'object') {
    const serialised = JSON.stringify(v)
    if (serialised.length > BODY_FIELD_CAP_BYTES) {
      return {
        length:         serialised.length,
        userControlled: true,
        truncated:      true,
      }
    }
    return { value: v, userControlled: true }
  }
  if (typeof v === 'string') {
    if (v.length > BODY_FIELD_CAP_BYTES) {
      return { length: v.length, userControlled: true, truncated: true }
    }
    return { value: v, userControlled: true }
  }
  return { value: v, userControlled: true }
}

function wrapUserString(v) {
  if (typeof v === 'string' && v.length > BODY_FIELD_CAP_BYTES) {
    return { length: v.length, userControlled: true, truncated: true }
  }
  return v
}

function truncateString(v) {
  if (typeof v !== 'string') return v
  if (v.length <= BODY_FIELD_CAP_BYTES) {
    return { value: v, userControlled: true }
  }
  return { length: v.length, userControlled: true, truncated: true }
}

/**
 * Wrap the body for the `includeBody:true` opt-in. The body is
 * ALWAYS marked userControlled and ALWAYS capped at the field-cap.
 * Already-parsed objects (the get_event path) are returned as-is
 * up to the cap; over-cap serialisations collapse to `{ length, truncated }`.
 */
function wrapIncludeBody(body) {
  if (body === null || body === undefined) {
    return { value: null, userControlled: true }
  }
  if (typeof body === 'string') {
    if (body.length <= BODY_FIELD_CAP_BYTES) {
      return { value: body, userControlled: true }
    }
    return { length: body.length, userControlled: true, truncated: true }
  }
  if (typeof body === 'object') {
    const serialised = JSON.stringify(body)
    if (serialised.length <= BODY_FIELD_CAP_BYTES) {
      return { value: body, userControlled: true }
    }
    return { length: serialised.length, userControlled: true, truncated: true }
  }
  return { value: body, userControlled: true }
}

function isJsonContentType(ct) {
  if (typeof ct !== 'string') return false
  const lower = ct.toLowerCase()
  return lower.includes('application/json') || lower.includes('+json')
}

/**
 * Sanitise tool-call params before they hit the audit log. Mirrors
 * the body-field cap so an attacker cannot stash a large payload in
 * any argument (today: `regex`, `header_key`, …). Strings longer
 * than the cap become `{ length, userControlled: true, truncated: true }`.
 */
export function sanitizeParamsForAudit(params) {
  if (!params || typeof params !== 'object' || Array.isArray(params)) return params
  const out = {}
  for (const [k, v] of Object.entries(params)) {
    if (typeof v === 'string') {
      out[k] = v.length > BODY_FIELD_CAP_BYTES
        ? { length: v.length, userControlled: true, truncated: true }
        : v
    } else if (Array.isArray(v)) {
      out[k] = v.map((entry) => typeof entry === 'string' && entry.length > BODY_FIELD_CAP_BYTES
        ? { length: entry.length, userControlled: true, truncated: true }
        : entry)
    } else if (v && typeof v === 'object') {
      out[k] = sanitizeParamsForAudit(v)
    } else {
      out[k] = v
    }
  }
  return out
}