import { useState, useEffect } from 'react'
import { rc } from '../styles.js'
import { checkForwardLoop } from '../lib/loopRule.js'

const PLACEHOLDER = 'http://localhost:3000/webhook'

function isDirty(draft, value) {
  return (draft || '').trim() !== (value || '').trim()
}

export default function ForwardConfigPanel({ token, value, onRequestSave, onRequestClear, busy, ingestUrl }) {
  const [draft, setDraft]     = useState(value || '')
  const [editing, setEditing] = useState(false)
  const [error, setError]     = useState(null)

  useEffect(() => {
    setDraft(value || '')
    setError(null)
  }, [value])

  const active = Boolean(value) || editing

  function enableNow() {
    setDraft('')
    setError(null)
    setEditing(true)
  }

  function disableNow() {
    setError(null)
    onRequestClear?.()
    setEditing(false)
  }

  function save() {
    const url = (draft || '').trim()
    if (!url) {
      setError('enter a URL')
      return
    }
    let parsed
    try { parsed = new URL(url) } catch (_e) {
      setError('URL is not valid')
      return
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      setError('only http: or https: URLs are allowed')
      return
    }
    const loop = checkForwardLoop(url, ingestUrl)
    if (!loop.ok) {
      setError(`loop detected — ${loop.message}. pick a different destination.`)
      return
    }
    setError(null)
    onRequestSave?.(url)
    setEditing(false)
  }

  function cancel() {
    setDraft(value || '')
    setError(null)
    setEditing(false)
  }

  const dirty = isDirty(draft, value)

  return (
    <div style={rc.section}>
      <div style={rc.sectionHead}>
        <span style={rc.sectionTitle}>forward to</span>
        <StatusPill active={active} />
      </div>

      <button
        type="button"
        onClick={active ? disableNow : enableNow}
        className="sb-switchrow"
        style={rc.switchRow}
        aria-pressed={active}
      >
        <span>
          <span style={rc.switchRowLabel}>proxy to url</span>
          <div style={rc.switchHint}>
            {active
              ? 'on — incoming webhooks are sent to the URL below and the response is relayed back'
              : 'off — incoming webhooks are captured and a 200 ok is returned'}
          </div>
        </span>
        <span style={{ ...rc.switchTrack, ...(active ? rc.switchTrackOn : {}) }}>
          <span style={{ ...rc.switchThumb, ...(active ? rc.switchThumbOn : {}) }} />
        </span>
      </button>

      {active && (
        <div style={rc.card}>
          <div style={rc.field}>
            <label style={rc.label}>destination url</label>
            <input
              type="url"
              value={draft}
              onChange={e => setDraft(e.target.value)}
              placeholder={PLACEHOLDER}
              spellCheck={false}
              autoComplete="off"
              style={{
                ...rc.input,
                borderColor: error ? 'var(--status-red)' : rc.input.border,
              }}
            />
            <div style={{ fontSize: '11px', fontFamily: 'var(--font-mono)', color: 'var(--text-muted)', letterSpacing: '0.04em' }}>
              http(s) only · 10s timeout · loop protection against {ingestUrl || 'this ingest origin'}
            </div>
          </div>

          <div style={rc.btnRow}>
            <button
              type="button"
              onClick={save}
              disabled={busy}
              className="sb-accent"
              style={rc.btnPrimary}
            >
              save
            </button>
            <button
              type="button"
              onClick={cancel}
              disabled={busy || !dirty}
              style={rc.btnGhost}
            >
              cancel
            </button>
            <button
              type="button"
              onClick={disableNow}
              disabled={busy}
              style={{ ...rc.btnGhost, color: 'var(--status-red)' }}
            >
              clear forward
            </button>
          </div>

          {error && <div style={rc.error}>{error}</div>}
        </div>
      )}

      {!active && (
        <div style={{ fontSize: '12px', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', letterSpacing: '0.04em' }}>
          toggle on to proxy webhooks to your dev server.
        </div>
      )}
    </div>
  )
}

function StatusPill({ active }) {
  if (active) {
    return (
      <span style={rc.pillOn}>
        <span style={rc.pillOnDot} />
        on · proxied
      </span>
    )
  }
  return <span style={rc.pillOff}>off · captured only</span>
}