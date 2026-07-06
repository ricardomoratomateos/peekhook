export function diffBodies(a, b) {
  const aText = a == null ? '' : String(a)
  const bText = b == null ? '' : String(b)
  const aLines = aText.split('\n')
  const bLines = bText.split('\n')
  const ops = lcsOps(aLines, bLines)
  const added = []
  const removed = []
  const common = []
  for (const op of ops) {
    if (op.type === 'common') common.push(op.a)
    else if (op.type === 'added') added.push(op.b)
    else removed.push(op.a)
  }
  return { added, removed, common, ops }
}

export function diffHeaders(aHeaders, bHeaders) {
  const a = aHeaders && typeof aHeaders === 'object' ? aHeaders : {}
  const b = bHeaders && typeof bHeaders === 'object' ? bHeaders : {}
  const aKeys = Object.keys(a)
  const bKeys = Object.keys(b)
  const allKeys = Array.from(new Set([...aKeys, ...bKeys]))
  const added = []
  const removed = []
  const changed = []
  const unchanged = []
  for (const key of allKeys) {
    const inA = aKeys.includes(key)
    const inB = bKeys.includes(key)
    if (inA && !inB) {
      removed.push({ key, value: a[key] })
    } else if (!inA && inB) {
      added.push({ key, value: b[key] })
    } else if (headerEqual(a[key], b[key])) {
      unchanged.push({ key, value: a[key] })
    } else {
      changed.push({ key, a: a[key], b: b[key] })
    }
  }
  const byKey = (x, y) => x.key.localeCompare(y.key)
  added.sort(byKey)
  removed.sort(byKey)
  changed.sort(byKey)
  unchanged.sort(byKey)
  return { added, removed, changed, unchanged }
}

export function diffChars(a, b) {
  const aText = a == null ? '' : String(a)
  const bText = b == null ? '' : String(b)
  if (aText === bText) return [{ type: 'eq', text: aText }]
  const m = aText.length
  const n = bText.length
  if (m === 0) return [{ type: 'ins', text: bText }]
  if (n === 0) return [{ type: 'del', text: aText }]
  const dp = Array.from({ length: m + 1 }, () => new Uint32Array(n + 1))
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (aText[i - 1] === bText[j - 1]) dp[i][j] = dp[i - 1][j - 1] + 1
      else dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1])
    }
  }
  const segs = []
  let i = m, j = n
  while (i > 0 && j > 0) {
    if (aText[i - 1] === bText[j - 1]) { segs.push({ type: 'eq', text: aText[i - 1] }); i--; j-- }
    else if (dp[i - 1][j] >= dp[i][j - 1]) { segs.push({ type: 'del', text: aText[i - 1] }); i-- }
    else { segs.push({ type: 'ins', text: bText[j - 1] }); j-- }
  }
  while (i > 0) { segs.push({ type: 'del', text: aText[i - 1] }); i-- }
  while (j > 0) { segs.push({ type: 'ins', text: bText[j - 1] }); j-- }
  segs.reverse()
  const merged = []
  for (const seg of segs) {
    if (merged.length && merged[merged.length - 1].type === seg.type) {
      merged[merged.length - 1].text += seg.text
    } else {
      merged.push({ type: seg.type, text: seg.text })
    }
  }
  return merged
}

function lcsOps(a, b) {
  const m = a.length
  const n = b.length
  if (m === 0 && n === 0) return []
  if (m === 0) return b.map(line => ({ type: 'added', b: line }))
  if (n === 0) return a.map(line => ({ type: 'removed', a: line }))
  const dp = Array.from({ length: m + 1 }, () => new Uint32Array(n + 1))
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (a[i - 1] === b[j - 1]) dp[i][j] = dp[i - 1][j - 1] + 1
      else dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1])
    }
  }
  const ops = []
  let i = m, j = n
  while (i > 0 && j > 0) {
    if (a[i - 1] === b[j - 1]) {
      ops.push({ type: 'common', a: a[i - 1], b: b[j - 1] })
      i--; j--
    } else if (dp[i - 1][j] >= dp[i][j - 1]) {
      ops.push({ type: 'removed', a: a[i - 1] })
      i--
    } else {
      ops.push({ type: 'added', b: b[j - 1] })
      j--
    }
  }
  while (i > 0) { ops.push({ type: 'removed', a: a[i - 1] }); i-- }
  while (j > 0) { ops.push({ type: 'added', b: b[j - 1] }); j-- }
  ops.reverse()
  return ops
}

function headerEqual(a, b) {
  if (a === b) return true
  return JSON.stringify(a) === JSON.stringify(b)
}