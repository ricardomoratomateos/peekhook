import { useEffect, useState } from 'react'
import { api } from '../../../lib/api.js'
import { c } from '../lib/tokens.js'

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

  if (loading && !data) return null
  if (!data || !data.fields || data.fields.length === 0) return null

  const topLevel = data.fields
    .filter(f => !f.path.includes('.'))
    .sort((a, b) => b.occurrences - a.occurrences)
    .slice(0, 6)

  const nested = data.fields.filter(f => f.path.includes('.')).length
  const totalOcc = data.fields.reduce((s, f) => s + f.occurrences, 0)

  return (
    <div style={wrap}>
      <div style={head}>
        <span style={title}>schema</span>
        <span style={meta}>
          {data.fields.length} fields · {nested} nested · {totalOcc} total
        </span>
      </div>
      <div style={rows}>
        {topLevel.map(f => (
          <div key={f.path} style={row}>
            <div style={rowLeft}>
              <span style={pathMono}>{f.path}</span>
              <span style={typeTag} data-type={f.type}>{f.type}</span>
            </div>
            <Sparkline n={f.occurrences} />
          </div>
        ))}
      </div>
    </div>
  )
}

function Sparkline({ n }) {
  const bars = []
  for (let i = 0; i < Math.min(n, 12); i++) {
    const heights = [4, 6, 8, 10, 12]
    const h = heights[i % heights.length]
    bars.push(
      <span
        key={i}
        style={{
          display: 'inline-block',
          width: '3px',
          height: `${h}px`,
          background: c.accent,
          opacity: i === bars.length - 1 ? 1 : 0.4,
          marginRight: '2px',
          borderRadius: '1px',
        }}
      />
    )
  }
  return (
    <span style={{ display: 'inline-flex', alignItems: 'flex-end', height: '14px', lineHeight: 1 }}>
      {bars}
      {n > 12 && (
        <span style={{ fontFamily: c.mono, fontSize: '9px', color: c.faint, marginLeft: '4px' }}>
          +{n - 12}
        </span>
      )}
    </span>
  )
}

const wrap = {
  margin: '0 12px 14px',
  padding: '10px 12px',
  border: '1px solid ' + c.border,
  borderRadius: '6px',
  background: c.bg,
  flexShrink: 0,
}

const head = {
  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
  marginBottom: '8px',
}

const title = {
  fontFamily: c.mono, fontSize: '10px', fontWeight: 600,
  color: c.faint, letterSpacing: '0.2em', textTransform: 'uppercase',
}

const meta = {
  fontFamily: c.mono, fontSize: '9px', color: c.faint, letterSpacing: '0.04em',
}

const rows = { display: 'flex', flexDirection: 'column', gap: '6px' }

const row = {
  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
  gap: '8px',
}

const rowLeft = {
  display: 'flex', alignItems: 'center', gap: '6px',
  minWidth: 0, flex: 1, overflow: 'hidden',
}

const pathMono = {
  fontFamily: c.mono, fontSize: '11px', color: c.dim,
  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0,
}

const typeTag = {
  fontFamily: c.mono, fontSize: '9px',
  padding: '1px 5px',
  borderRadius: '3px',
  background: c.low,
  color: c.fg,
  border: '1px solid ' + c.border,
  flexShrink: 0,
}
