/**
 * Header sanitization — strip characters from HTTP header values that
 * could enable filename spoofing, log injection, or stored XSS via the
 * inspector's render layer.
 *
 * The inspector renders captured headers verbatim; React escapes by
 * default, but a header that contains a right-to-left override
 * (`U+202E`) can still flip a filename so it visually ends in
 * `.exe` while the file-extension rule (`.pdf`, `.png`, ...) is at
 * the start. The same RTL-override trick that fools humans can also
 * fool screenshot-based reviewers triaging abuse reports.
 *
 * Policy (ROADMAP "Header sanitization"):
 *   - Strip NUL (`U+0000`) and other C0 control bytes (`U+0001`-`U+0008`,
 *     `U+000B`-`U+001F`) — these are disallowed by RFC 7230 and aren't
 *     produced by legit HTTP clients.
 *   - Strip DEL (`U+007F`).
 *   - Strip the bidirectional override set (`U+202A`-`U+202E`,
 *     `U+2066`-`U+2069`) — these exist purely to flip the visual
 *     direction of text and have no place in a webhook header.
 *   - Preserve TAB (`U+0009`) — it is explicitly allowed by RFC 7230
 *     and shows up in folded header values.
 *   - LF (`U+000A`) and CR (`U+000D`) are kept stripped too. Fastify's
 *     header parser already rejects them at the wire; sanitizing here
 *     guards against the (currently unused) JSON-array header variant
 *     like `["foo\r\nbar"]` slipping through and corrupting the stored
 *     document.
 *
 * Sanitization is silent on the happy path (legitimate headers pass
 * through untouched) and the cheap path (no allocation when no
 * characters match). The caller decides whether to log a warning; the
 * `sanitize()` helper returns `{ sanitized, stripped: boolean }` so
 * the route handler can `req.log.warn(...)` on the rare `stripped=true`
 * case without leaking the header value (which itself may carry PII).
 */

const UNSAFE_HEADER_CHARS = /[\u0000-\u0008\u000B-\u001F\u007F\u202A-\u202E\u2066-\u2069]/g

/**
 * @param {unknown} value
 * @returns {string}
 */
function cleanOne(value) {
  if (typeof value !== 'string') return value
  if (value.indexOf('\u0000') < 0
   && value.indexOf('\u202E') < 0
   && value.indexOf('\u202D') < 0) {
    if (!UNSAFE_HEADER_CHARS.test(value)) return value
    UNSAFE_HEADER_CHARS.lastIndex = 0
  }
  return value.replace(UNSAFE_HEADER_CHARS, '')
}

/**
 * Sanitize a Fastify-shaped headers object (string values, possibly
 * string[] values). Returns `{ sanitized, stripped }`.
 *
 * @param {object|null|undefined} headers
 * @returns {{ sanitized: object, stripped: boolean }}
 */
export function sanitizeHeaders(headers) {
  if (!headers || typeof headers !== 'object') {
    return { sanitized: {}, stripped: false }
  }
  let stripped = false
  const out = {}
  for (const [k, v] of Object.entries(headers)) {
    if (typeof v === 'string') {
      const cleaned = cleanOne(v)
      if (cleaned !== v) stripped = true
      out[k] = cleaned
    } else if (Array.isArray(v)) {
      const cleanedArr = v.map((item) => {
        const c = cleanOne(item)
        if (c !== item) stripped = true
        return c
      })
      out[k] = cleanedArr
    } else {
      out[k] = v
    }
  }
  if (!stripped) return { sanitized: headers, stripped: false }
  return { sanitized: out, stripped }
}
