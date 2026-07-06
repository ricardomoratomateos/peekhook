import { useEffect, useState, useMemo } from 'react'
import { api } from '../../../lib/api.js'
import { c } from '../lib/tokens.js'
import { sc } from '../styles.js'

export default function SchemaSparkline({ token }) {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [expanded, setExpanded] = useState(() => new Set())

  useEffect(() => {
    let cancelled = false
    let timer = null

    async function fetchOnce() {
      try {
        const result = await api.getSchemaHistory(token)
        if (!cancelled) setData(result)
      } catch (_) {
        if (!cancelled) setData(null)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    fetchOnce()
    timer = setInterval(fetchOnce, 5_000)

    return () => {
      cancelled = true
      if (timer) clearInterval(timer)
    }
  }, [token])

  const tree = useMemo(() => buildTree(data?.fields || []), [data])
  const totalOcc = useMemo(
    () => (data?.fields || []).reduce((s, f) => s + f.occurrences, 0),
    [data]
  )
  const flatRows = useMemo(
    () => flatten(tree, 0, expanded),
    [tree, expanded]
  )

  if (loading && !data) return null
  if (!data || !data.fields || data.fields.length === 0) {
    return (
      <div style={sc.section}>
        <div style={sc.card}>
          <div style={sc.cardHead}>
            <span style={sc.cardTitle}>schema</span>
          </div>
          <div style={sc.empty}>no captured requests yet — schema will appear after the first request lands.</div>
        </div>
      </div>
    )
  }

  const toggle = (path) => {
    setExpanded(prev => {
      const next = new Set(prev)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      return next
    })
  }

  return (
    <div style={sc.section}>
      <div style={sc.card}>
        <div style={sc.cardHead}>
          <span style={sc.cardTitle}>fields</span>
          <span style={sc.cardMeta}>
            {data.fields.length} fields · {totalOcc} total occurrences
          </span>
        </div>
        <div style={sc.table}>
          <div style={sc.tableHead}>
            <span>path</span>
            <span>type</span>
            <span>n</span>
            <span>shape</span>
          </div>
          {flatRows.map((row, idx) => {
            const isLast = idx === flatRows.length - 1
            return (
              <div
                key={row.path}
                onClick={row.hasChildren ? () => toggle(row.path) : undefined}
                style={
                  isLast
                    ? { ...sc.tableRow, ...sc.tableRowLast, ...(row.hasChildren ? rowClickable : null) }
                    : { ...sc.tableRow, ...(row.hasChildren ? rowClickable : null) }
                }
                role={row.hasChildren ? 'button' : undefined}
                aria-expanded={row.hasChildren ? expanded.has(row.path) : undefined}
                tabIndex={row.hasChildren ? 0 : undefined}
                onKeyDown={row.hasChildren ? (e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault()
                    toggle(row.path)
                  }
                } : undefined}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', paddingLeft: `${row.depth * 18}px`, minWidth: 0 }}>
                  {row.hasChildren ? (
                    <span
                      style={{
                        ...caret,
                        transform: expanded.has(row.path) ? 'rotate(90deg)' : 'rotate(0deg)',
                      }}
                    >
                      ▸
                    </span>
                  ) : (
                    <span style={caretPlaceholder} />
                  )}
                  <span style={sc.pathMono}>{row.leaf}</span>
                </div>
                <span style={sc.typeTag}>{row.type}</span>
                <span style={sc.countMono}>{row.n}</span>
                <Sparkline n={row.n} variant={row.hasChildren && !row.field ? 'parent' : 'leaf'} />
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

const caret = {
  display: 'inline-block',
  fontSize: '10px',
  color: c.faint,
  lineHeight: 1,
  transition: 'transform 120ms ease',
  transformOrigin: 'center',
  width: '12px',
  textAlign: 'center',
}

const caretPlaceholder = {
  display: 'inline-block',
  width: '12px',
  height: '12px',
}

const rowClickable = {
  cursor: 'pointer',
}

function buildTree(fields) {
  const root = { children: new Map() }
  for (const f of fields) {
    const parts = f.path.split('.')
    let node = root
    let acc = ''
    for (let i = 0; i < parts.length; i++) {
      acc = acc ? acc + '.' + parts[i] : parts[i]
      if (!node.children.has(parts[i])) {
        node.children.set(parts[i], { children: new Map(), path: acc, leaf: parts[i] })
      }
      node = node.children.get(parts[i])
    }
    node.field = f
  }
  return root
}

function flatten(root, depth, expanded) {
  const rows = []
  const top = [...root.children.values()].sort(
    (a, b) => (b.field?.occurrences || childCount(b)) - (a.field?.occurrences || childCount(a))
  )
  for (const node of top) {
    const f = node.field
    const hasChildren = node.children.size > 0
    const n = f ? f.occurrences : childCount(node)
    rows.push({
      path: node.path,
      leaf: node.leaf,
      type: f?.type || 'object',
      n,
      depth,
      hasChildren,
      field: f || null,
    })
    if (hasChildren && expanded.has(node.path)) {
      rows.push(...flatten(node, depth + 1, expanded))
    }
  }
  return rows
}

function childCount(node) {
  let n = 0
  for (const c of node.children.values()) n += 1 + childCount(c)
  return n
}

function Sparkline({ n, variant = 'leaf' }) {
  if (variant === 'parent') {
    const cap = Math.min(n, 14)
    const bars = []
    for (let i = 0; i < cap; i++) {
      bars.push(
        <span
          key={i}
          style={{
            display: 'inline-block',
            width: '3px',
            height: '4px',
            background: c.accent,
            opacity: 0.55,
            marginRight: '2px',
            borderRadius: '1px',
          }}
        />
      )
    }
    return (
      <span style={{ display: 'inline-flex', alignItems: 'center', height: '14px' }}>
        {bars}
        {n > cap && (
          <span style={{ fontFamily: c.mono, fontSize: '9px', color: c.faint, marginLeft: '4px' }}>
            +{n - cap}
          </span>
        )}
      </span>
    )
  }
  const bars = []
  const cap = Math.min(n, 14)
  const heights = [4, 6, 8, 10, 12]
  for (let i = 0; i < cap; i++) {
    const h = heights[i % heights.length]
    bars.push(
      <span
        key={i}
        style={{
          display: 'inline-block',
          width: '3px',
          height: `${h}px`,
          background: c.accent,
          opacity: i === cap - 1 ? 1 : 0.4,
          marginRight: '2px',
          borderRadius: '1px',
        }}
      />
    )
  }
  return (
    <span style={{ display: 'inline-flex', alignItems: 'flex-end', height: '14px', lineHeight: 1 }}>
      {bars}
      {n > cap && (
        <span style={{ fontFamily: c.mono, fontSize: '9px', color: c.faint, marginLeft: '4px' }}>
          +{n - cap}
        </span>
      )}
    </span>
  )
}
