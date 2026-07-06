import { useState, useEffect } from 'react'
import { c } from '../lib/tokens.js'
import { api } from '../../../lib/api.js'
import { parseNaturalLanguage } from '../lib/nlParse.js'

const EXAMPLES = [
  'stripe events',
  'events over $50',
  'github push',
  'error responses',
]

export default function SearchBar({ token, onResults, onClear }) {
  const [query, setQuery] = useState('')
  const [field, setField] = useState('body')
  const [status, setStatus] = useState('idle')
  const [count, setCount] = useState(null)
  const [error, setError] = useState(null)
  const [nlResolved, setNlResolved] = useState(null)

  useEffect(() => {
    if (!token || !query.trim()) {
      setStatus('idle')
      setCount(null)
      setError(null)
      setNlResolved(null)
      onClear?.()
      return
    }

    const parsed = parseNaturalLanguage(query)
    const useField = parsed.field || field
    const useRegex = parsed.regex || query

    if (useRegex !== query || useField !== field) {
      setNlResolved({ regex: useRegex, field: useField, provider: parsed.provider, amount: parsed.amount })
    } else {
      setNlResolved(null)
    }

    const timer = setTimeout(async () => {
      setStatus('searching')
      setError(null)
      try {
        const result = await api.searchEvents(token, { regex: useRegex, field: useField })
        const arr = Array.isArray(result) ? result : []
        setCount(arr.length)
        setStatus('done')
        onResults?.(arr)
      } catch (err) {
        setError(err.message || 'search failed')
        setStatus('error')
        onResults?.([])
      }
    }, 250)

    return () => clearTimeout(timer)
  }, [query, field, token])

  function applyExample(ex) {
    setQuery(ex)
  }

  return (
    <div style={wrap}>
      <div style={head}>
        <span style={title}>search</span>
        <span style={pill}>
          {status === 'searching' ? '…'
            : status === 'error' ? 'error'
            : status === 'done' ? `${count} match${count === 1 ? '' : 'es'}`
            : 'idle'}
        </span>
      </div>
      <input
        type="text"
        value={query}
        onChange={e => setQuery(e.target.value)}
        placeholder="regex or natural language…"
        spellCheck={false}
        style={{
          ...input,
          borderColor: status === 'error' ? 'var(--status-red)' : c.border,
        }}
      />
      <div style={fieldRow}>
        {['body', 'path', 'header:user-agent'].map(f => (
          <button
            key={f}
            type="button"
            onClick={() => setField(f)}
            className="sb-searchfield"
            style={{
              ...fieldBtn,
              ...(field === f ? fieldBtnActive : {}),
            }}
            aria-pressed={field === f}
          >
            {f}
          </button>
        ))}
      </div>
      {nlResolved && (
        <div style={hintRow}>
          <span style={hintLabel}>translated to</span>
          <code style={hintCode}>{nlResolved.regex}</code>
          {nlResolved.field !== field && (
            <>
              <span style={hintLabel}>in</span>
              <code style={hintCode}>{nlResolved.field}</code>
            </>
          )}
        </div>
      )}
      {query === '' && (
        <div style={examplesRow}>
          <span style={examplesLabel}>try</span>
          {EXAMPLES.map(ex => (
            <button
              key={ex}
              type="button"
              onClick={() => applyExample(ex)}
              className="sb-searchexample"
              style={exampleBtn}
            >
              {ex}
            </button>
          ))}
        </div>
      )}
      {error && <div style={errMsg}>{error}</div>}
    </div>
  )
}

const wrap = {
  margin: '0 12px 14px',
  padding: '10px 12px',
  border: `1px solid ${c.border}`,
  borderRadius: '6px',
  background: c.bg,
  flexShrink: 0,
  display: 'flex',
  flexDirection: 'column',
  gap: '6px',
}

const head = {
  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
  marginBottom: '2px',
}

const title = {
  fontFamily: c.mono, fontSize: '10px', fontWeight: 600,
  color: c.faint, letterSpacing: '0.2em', textTransform: 'uppercase',
}

const pill = {
  fontFamily: c.mono, fontSize: '10px', color: c.faint, letterSpacing: '0.04em',
}

const input = {
  width: '100%',
  background: c.lowest,
  border: `1px solid ${c.border}`,
  borderRadius: '4px',
  color: c.fg,
  fontFamily: c.mono,
  fontSize: '11px',
  padding: '6px 8px',
  outline: 'none',
}

const fieldRow = {
  display: 'flex', gap: '4px', flexWrap: 'wrap',
}

const fieldBtn = {
  background: 'transparent',
  border: `1px solid ${c.border}`,
  borderRadius: '3px',
  color: c.faint,
  fontFamily: c.mono,
  fontSize: '9px',
  padding: '2px 6px',
  cursor: 'pointer',
  letterSpacing: '0.04em',
  transition: 'background 0.12s, color 0.12s, border-color 0.12s',
}
const fieldBtnActive = {
  background: c.low,
  color: c.fg,
  borderColor: c.borderSoft,
}

const hintRow = {
  display: 'flex', alignItems: 'center', gap: '4px', flexWrap: 'wrap',
  fontSize: '10px',
}
const hintLabel = {
  fontFamily: c.mono, color: c.faint, textTransform: 'uppercase', letterSpacing: '0.1em',
}
const hintCode = {
  fontFamily: c.mono, color: c.dim, background: c.low,
  padding: '1px 4px', borderRadius: '3px', fontSize: '10px',
}

const examplesRow = {
  display: 'flex', alignItems: 'center', gap: '4px', flexWrap: 'wrap',
}
const examplesLabel = {
  fontFamily: c.mono, fontSize: '9px', color: c.faint, textTransform: 'uppercase', letterSpacing: '0.1em',
  marginRight: '2px',
}
const exampleBtn = {
  background: 'transparent',
  border: '1px dashed ' + c.border,
  borderRadius: '3px',
  color: c.dim,
  fontFamily: c.mono,
  fontSize: '9px',
  padding: '2px 5px',
  cursor: 'pointer',
  letterSpacing: '0.04em',
  transition: 'color 0.12s, border-color 0.12s',
}

const errMsg = {
  fontSize: '11px',
  color: 'var(--status-red)',
  fontFamily: c.mono,
}
