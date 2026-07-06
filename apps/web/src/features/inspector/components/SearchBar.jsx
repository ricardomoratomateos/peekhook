import { useState, useEffect } from 'react'
import { c } from '../lib/tokens.js'
import { api } from '../../../lib/api.js'
import { parseNaturalLanguage } from '../lib/nlParse.js'

const FIELDS = ['body', 'path', 'header:user-agent']

export default function SearchBar({ token, onResults, onClear }) {
  const [query, setQuery] = useState('')
  const [field, setField] = useState('body')
  const [status, setStatus] = useState('idle')
  const [count, setCount] = useState(null)
  const [error, setError] = useState(null)

  useEffect(() => {
    if (!token || !query.trim()) {
      setStatus('idle')
      setCount(null)
      setError(null)
      onClear?.()
      return
    }

    const parsed = parseNaturalLanguage(query)
    const useField = parsed.field || field
    const useRegex = parsed.regex || query

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

  function cycleField() {
    const i = FIELDS.indexOf(field)
    setField(FIELDS[(i + 1) % FIELDS.length])
  }

  const statusDot = status === 'searching' ? c.accent
    : status === 'error' ? 'var(--status-red)'
    : status === 'done' ? c.accent
    : c.faint

  return (
    <div style={bar}>
      <span className="material-symbols-outlined" style={icon}>search</span>
      <input
        type="text"
        value={query}
        onChange={e => setQuery(e.target.value)}
        placeholder="search requests…"
        spellCheck={false}
        aria-label="search requests"
        style={input}
      />
      {query && (
        <>
          <span style={{ ...dot, background: statusDot }} aria-hidden />
          <span style={statusText}>
            {status === 'searching' ? '…'
              : status === 'error' ? 'err'
              : status === 'done' ? `${count}`
              : ''}
          </span>
        </>
      )}
      <button
        type="button"
        onClick={cycleField}
        style={fieldPill}
        aria-label={`search in ${field}, click to change`}
        title={`search in ${field}`}
      >
        {field}
      </button>
    </div>
  )
}

const bar = {
  display: 'flex',
  alignItems: 'center',
  gap: '8px',
  padding: '8px 10px',
  border: `1px solid ${c.border}`,
  borderRadius: '8px',
  background: c.bg,
  flexShrink: 0,
}

const icon = {
  fontSize: '15px',
  color: c.faint,
  lineHeight: 1,
  flexShrink: 0,
}

const input = {
  flex: 1,
  minWidth: 0,
  background: 'transparent',
  border: 'none',
  color: c.fg,
  fontFamily: c.mono,
  fontSize: '12px',
  padding: 0,
  outline: 'none',
}

const dot = {
  width: '6px',
  height: '6px',
  borderRadius: '50%',
  flexShrink: 0,
  transition: 'background 0.15s',
}

const statusText = {
  fontFamily: c.mono,
  fontSize: '10px',
  color: c.faint,
  letterSpacing: '0.04em',
  minWidth: '20px',
}

const fieldPill = {
  fontFamily: c.mono,
  fontSize: '10px',
  color: c.dim,
  background: c.ctr,
  border: `1px solid ${c.border}`,
  borderRadius: '999px',
  padding: '2px 8px',
  cursor: 'pointer',
  flexShrink: 0,
  letterSpacing: '0.04em',
  transition: 'background 0.12s, color 0.12s',
}