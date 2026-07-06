import { useEffect, useState, useMemo } from 'react'
import { api } from '../../../lib/api.js'
import { c } from '../lib/tokens.js'
import { sc } from '../styles.js'

export default function SchemaSparkline({ token }) {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)

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

  const { topLevel, nested, totalOcc } = useMemo(() => {
    if (!data?.fields) return { topLevel: [], nested: [], totalOcc: 0 }
    const top = data.fields
      .filter(f => !f.path.includes('.'))
      .sort((a, b) => b.occurrences - a.occurrences)
    const nst = data.fields
      .filter(f => f.path.includes('.'))
      .sort((a, b) => b.occurrences - a.occurrences)
    const total = data.fields.reduce((s, f) => s + f.occurrences, 0)
    return { topLevel: top, nested: nst, totalOcc: total }
  }, [data])

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

  return (
    <div style={sc.section}>
      <div style={sc.card}>
        <div style={sc.cardHead}>
          <span style={sc.cardTitle}>top-level fields</span>
          <span style={sc.cardMeta}>
            {topLevel.length} fields · {totalOcc} total occurrences
          </span>
        </div>
        {topLevel.length === 0 ? (
          <div style={sc.empty}>no top-level fields yet</div>
        ) : (
          <div style={sc.table}>
            <div style={sc.tableHead}>
              <span>path</span>
              <span>type</span>
              <span>n</span>
              <span>shape</span>
            </div>
            {topLevel.map((f, idx) => (
              <div
                key={f.path}
                style={idx === topLevel.length - 1 ? { ...sc.tableRow, ...sc.tableRowLast } : sc.tableRow}
              >
                <span style={sc.pathMono}>{f.path}</span>
                <span style={sc.typeTag}>{f.type}</span>
                <span style={sc.countMono}>{f.occurrences}</span>
                <Sparkline n={f.occurrences} />
              </div>
            ))}
          </div>
        )}
      </div>

      {nested.length > 0 && (
        <div style={sc.card}>
          <div style={sc.cardHead}>
            <span style={sc.cardTitle}>nested fields</span>
            <span style={sc.cardMeta}>{nested.length} paths</span>
          </div>
          <div style={sc.table}>
            <div style={sc.tableHead}>
              <span>path</span>
              <span>type</span>
              <span>n</span>
              <span>shape</span>
            </div>
            {nested.map((f, idx) => (
              <div
                key={f.path}
                style={idx === nested.length - 1 ? { ...sc.tableRow, ...sc.tableRowLast } : sc.tableRow}
              >
                <span style={sc.pathMono}>{f.path}</span>
                <span style={sc.typeTag}>{f.type}</span>
                <span style={sc.countMono}>{f.occurrences}</span>
                <Sparkline n={f.occurrences} />
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function Sparkline({ n }) {
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