/**
 * Pure allowlist matcher for the per-inbox capture filter.
 *
 * A `captureFilter` is an allowlist: a request is captured (logged) only
 * when it satisfies EVERY dimension that the filter constrains, and within
 * a single dimension satisfying ANY one entry is enough. Formally:
 *
 *   AND across the present dimensions (methods, paths, headers, query),
 *   OR  within each dimension's list.
 *
 * A dimension that is absent or empty imposes no constraint. A filter with
 * no constrained dimensions (or a null/undefined filter) matches everything
 * — i.e. capture behaves exactly as it does with no filter configured.
 *
 * Semantics per dimension:
 *   - methods: case-insensitive exact match against the request method.
 *   - paths:   glob match against the request path (without query string).
 *              `*` is a wildcard matching any run of characters, including
 *              `/`, so `/api/*` matches `/api/users/42`. A pattern with no
 *              `*` is an exact (anchored) match.
 *   - headers: `{ name, value? }`. Header name match is case-insensitive.
 *              With `value`, the header's value must equal it exactly
 *              (case-sensitive); without `value`, mere presence suffices.
 *   - query:   `{ name, value? }`. Same rule as headers, against the parsed
 *              query object.
 *
 * Side-effect free and synchronous so the identical implementation could be
 * mirrored into the web inspector for instant preview (the `loopRule`
 * pattern) without pulling in server code. Today it runs only in the API, at
 * capture time (CaptureRequest).
 *
 * @param {{
 *   method:  string,
 *   path:    string,
 *   query?:  Record<string, unknown>,
 *   headers?: Record<string, unknown>,
 * }} req
 * @param {null | undefined | {
 *   methods?: string[],
 *   paths?:   string[],
 *   headers?: Array<{ name: string, value?: string | null }>,
 *   query?:   Array<{ name: string, value?: string | null }>,
 * }} filter
 * @returns {boolean} true when the request should be captured
 */
export function matchesCaptureFilter(req, filter) {
  if (!filter || typeof filter !== 'object') return true

  const methods = Array.isArray(filter.methods) ? filter.methods : []
  const paths   = Array.isArray(filter.paths)   ? filter.paths   : []
  const headers = Array.isArray(filter.headers) ? filter.headers : []
  const query   = Array.isArray(filter.query)   ? filter.query   : []

  if (methods.length > 0) {
    const m = String(req.method ?? '').toUpperCase()
    if (!methods.some((rule) => String(rule).toUpperCase() === m)) return false
  }

  if (paths.length > 0) {
    const p = String(req.path ?? '')
    if (!paths.some((pattern) => matchGlob(p, pattern))) return false
  }

  if (headers.length > 0) {
    if (!headers.some((rule) => matchKeyValue(req.headers, rule, { caseInsensitiveName: true }))) {
      return false
    }
  }

  if (query.length > 0) {
    if (!query.some((rule) => matchKeyValue(req.query, rule, { caseInsensitiveName: false }))) {
      return false
    }
  }

  return true
}

/**
 * Match a name/value rule against a bag of key→value pairs.
 *
 * HTTP header names are case-insensitive, so we lower-case both sides for
 * the header dimension. Query keys are case-sensitive per the URL spec, so
 * they are matched verbatim. When `value` is present the stored value must
 * equal it exactly; when absent, mere presence of the key is a match.
 */
function matchKeyValue(bag, rule, { caseInsensitiveName }) {
  if (!bag || typeof bag !== 'object' || !rule || typeof rule.name !== 'string') return false

  const wantName = caseInsensitiveName ? rule.name.toLowerCase() : rule.name
  const wantValue = rule.value

  for (const key of Object.keys(bag)) {
    const cmpKey = caseInsensitiveName ? key.toLowerCase() : key
    if (cmpKey !== wantName) continue
    if (wantValue === undefined || wantValue === null) return true
    if (valueMatches(bag[key], wantValue)) return true
  }
  return false
}

/**
 * A header/query value can be a scalar or (for repeated keys) an array.
 * The rule matches when the scalar equals `want`, or when any element of
 * the array equals it.
 */
function valueMatches(actual, want) {
  if (Array.isArray(actual)) return actual.some((v) => String(v) === want)
  return String(actual) === want
}

/**
 * Glob match where `*` stands for any run of characters (including `/`).
 * Every other character is treated literally — all regex metacharacters
 * are escaped so a pattern like `/api/v1.0/*` matches literally on the dot.
 * The whole path must match (anchored at both ends).
 */
export function matchGlob(value, pattern) {
  if (typeof pattern !== 'string') return false
  const escaped = pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const re = new RegExp('^' + escaped.replace(/\\\*/g, '.*') + '$')
  return re.test(value)
}
