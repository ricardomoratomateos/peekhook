/**
 * diff_events tool handler.
 *
 * Fetches two events by id, both scoped to the authenticated inbox
 * token, then returns:
 *   - `a`, `b`: full DTOs (body parsed as JSON when content-type is
 *     JSON, identical to the `get_event` projection)
 *   - `header_diff`: `[{ key, a, b, changed }]` for every header key
 *     in the union of the two event header sets
 *   - `body_diff`: line-level diff prefixed `+` / `-` / ` ` for adds,
 *     deletes, equal lines. JSON bodies are pretty-printed first
 *     so field-level edit locations are easy to read.
 *
 * Hand-rolled (zero-dep) LCS over lines. Diff size is bounded by
 * individual request payloads — typically a few KB.
 */
export class DiffEventsTool {
  constructor({ readModel }) {
    this.readModel = readModel
  }

  /**
   * @param {{
   *   inbox_token: string,
   *   event_a_id: string,
   *   event_b_id: string,
   * }} args
   * @returns {Promise<{
   *   a: object | null,
   *   b: object | null,
   *   header_diff: Array<{ key: string, a?: string, b?: string, changed: boolean }>,
   *   body_diff: string,
   * }>}
   */
  async execute({ inbox_token, event_a_id, event_b_id }) {
    const [a, b] = await Promise.all([
      this.readModel.findById({ inboxToken: inbox_token, id: event_a_id }),
      this.readModel.findById({ inboxToken: inbox_token, id: event_b_id }),
    ])
    if (!a) throw new Error(`event_a (${event_a_id}) not found`)
    if (!b) throw new Error(`event_b (${event_b_id}) not found`)

    return {
      a,
      b,
      header_diff: diffHeaders(a.headers ?? {}, b.headers ?? {}),
      body_diff:   diffBodies(a.body ?? '', b.body ?? ''),
    }
  }
}

function diffHeaders(a, b) {
  const keys = new Set([...Object.keys(a ?? {}), ...Object.keys(b ?? {})])
  const out = []
  for (const key of [...keys].sort()) {
    const av = a?.[key]
    const bv = b?.[key]
    const inA = key in (a ?? {})
    const inB = key in (b ?? {})
    let changed = false
    if (!inA || !inB) changed = true
    else if (Array.isArray(av) && Array.isArray(bv)) changed = av.join(',') !== bv.join(',')
    else if (av !== bv) changed = true
    out.push({ key, a: av, b: bv, changed })
  }
  return out
}

function prettyBody(raw) {
  if (typeof raw !== 'string') return ''
  try { return JSON.stringify(JSON.parse(raw), null, 2) } catch { /* not JSON */ }
  return raw
}

function diffBodies(rawA, rawB) {
  const A = prettyBody(rawA).split('\n')
  const B = prettyBody(rawB).split('\n')
  return lcsDiff(A, B).map(([marker, line]) => `${marker} ${line}`).join('\n')
}

function lcsDiff(a, b) {
  const m = a.length, n = b.length
  const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0))
  for (let i = 0; i < m; i++) {
    for (let j = 0; j < n; j++) {
      dp[i + 1][j + 1] = a[i] === b[j] ? dp[i][j] + 1 : Math.max(dp[i][j + 1], dp[i + 1][j])
    }
  }
  const stack = []
  let i = m, j = n
  while (i > 0 && j > 0) {
    if (a[i - 1] === b[j - 1]) { stack.push([' ', a[i - 1]]); i--; j-- }
    else if (dp[i - 1][j] >= dp[i][j - 1]) { stack.push(['-', a[i - 1]]); i-- }
    else { stack.push(['+', b[j - 1]]); j-- }
  }
  while (i > 0) { stack.push(['-', a[i - 1]]); i-- }
  while (j > 0) { stack.push(['+', b[j - 1]]); j-- }
  return stack.reverse()
}
