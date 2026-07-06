/**
 * PayloadSignature — pure JSON-shape walker.
 *
 * Walks a parsed JSON value (or raw body string) and produces a flat list of
 * `{ path, type }` entries describing the schema. Used to record field shapes
 * over time per inbox (the comparator wedge: schema-history sparkline).
 *
 * Types emitted: 'string' | 'number' | 'boolean' | 'null' | 'array' | 'object'.
 *
 * Path rules:
 *   - scalar root          → path ''                             (typed leaf)
 *   - object root          → recurse into each key, no root entry
 *                            (children use their key as path)
 *   - nested object        → recurse, joining keys with '.'
 *   - empty object         → single entry with type 'object' (no key to recurse)
 *   - array (root or child)→ single entry with type 'array', NO element walk.
 *                            v1 deliberately ignores arrays-of-objects to
 *                            bound cardinality and keep the sparkline legible.
 *
 * Pure function. No I/O. No mongodb. No infra imports. Safe to call inline
 * at capture time; the use case wraps in try/catch so callers never block.
 */

/**
 * Walk the JSON body and return an ordered list of `{ path, type }` entries.
 * Parses the body string internally; throws `Error("body: invalid JSON ...")`
 * on parse failure so the use case can catch by message and skip the request.
 *
 * @param {string} body — the raw request body, expected to be valid JSON.
 * @returns {{ path: string, type: string }[]}
 */
export function signatureOf(body) {
  if (typeof body !== 'string') {
    throw new Error('body: expected string')
  }
  let parsed
  try {
    parsed = JSON.parse(body)
  } catch (err) {
    throw new Error(`body: invalid JSON (${err.message})`)
  }
  return walk(parsed, '')
}

/**
 * Walk an already-parsed value. Exported so callers that already hold the
 * parsed JSON (tests, future streaming parser) can skip the redundant parse.
 *
 * @param {*} value
 * @param {string} path — accumulated path from the recursion above
 * @returns {{ path: string, type: string }[]}
 */
export function walk(value, path) {
  const out = []
  collect(value, path, out)
  return out
}

function collect(value, path, out) {
  if (value === null) {
    out.push({ path, type: 'null' })
    return
  }
  if (Array.isArray(value)) {
    out.push({ path, type: 'array' })
    return
  }
  const t = typeof value
  if (t === 'string' || t === 'number' || t === 'boolean') {
    out.push({ path, type: t })
    return
  }
  if (t === 'object') {
    const keys = Object.keys(value)
    if (keys.length === 0) {
      out.push({ path, type: 'object' })
      return
    }
    for (const key of keys) {
      collect(value[key], path ? `${path}.${key}` : key, out)
    }
    return
  }
}
