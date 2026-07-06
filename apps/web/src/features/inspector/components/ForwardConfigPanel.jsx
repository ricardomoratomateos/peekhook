import { useState, useEffect } from 'react'
import { rc } from '../styles.js'

const PLACEHOLDER = 'http://localhost:3000/webhook'

export default function ForwardConfigPanel({ token, value, onRequestSave, onRequestClear, busy }) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft]     = useState(value || '')
  const [error, setError]     = useState(null)

  useEffect(() => {
    if (editing) return
    setDraft(value || '')
    setError(null)
  }, [value, editing])

  const active = Boolean(value)

  function startEdit() {
    setDraft(value || '')
    setError(null)
    setEditing(true)
  }

  function cancelEdit() {
    setDraft(value || '')
    setError(null)
    setEditing(false)
  }

  function validateAndSave() {
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
    setError(null)
    onRequestSave?.(url)
    setEditing(false)
  }

  function clear() {
    setError(null)
    onRequestClear?.()
    setEditing(false)
  }

  function toggle(next) {
    if (!next) {
      if (value) clear()
      setEditing(false)
      return
    }
    startEdit()
  }

  return (
    <div style={rc.section}>
      <div style={rc.sectionHead}>
        <span style={rc.sectionTitle}>forward to</span>
        {active
          ? <span style={rc.pillOn}><span style={rc.pillOnDot} />on · proxied</span>
          : <span style={rc.pillOff}>off · captured only</span>}
      </div>

      <button
        type="button"
        onClick={() => toggle(!active)}
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

      {(active || editing) && (
        <div style={rc.card}>
          {editing && (
            <>
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
                  http(s) only · 10s timeout · loop protection against this ingest origin
                </div>
              </div>

              <div style={rc.btnRow}>
                <button
                  type="button"
                  onClick={validateAndSave}
                  disabled={busy}
                  className="sb-accent"
                  style={rc.btnPrimary}
                >
                  save
                </button>
                <button
                  type="button"
                  onClick={cancelEdit}
                  disabled={busy}
                  style={rc.btnGhost}
                >
                  cancel
                </button>
                {value && (
                  <button
                    type="button"
                    onClick={clear}
                    disabled={busy}
                    style={{ ...rc.btnGhost, color: 'var(--status-red)' }}
                  >
                    clear forward
                  </button>
                )}
              </div>

              {error && <div style={rc.error}>{error}</div>}
            </>
          )}

          {!editing && value && (
            <>
              <div style={rc.field}>
                <label style={rc.label}>destination url</label>
                <div style={{ ...rc.input, color: 'var(--text-body)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {value}
                </div>
              </div>
              <div style={rc.btnRow}>
                <button
                  type="button"
                  onClick={startEdit}
                  className="sb-accent"
                  style={rc.btnPrimary}
                >
                  edit
                </button>
                <button
                  type="button"
                  onClick={clear}
                  disabled={busy}
                  style={{ ...rc.btnGhost, color: 'var(--status-red)' }}
                >
                  clear forward
                </button>
              </div>
            </>
          )}

          {!editing && !value && (
            <div style={{ fontSize: '12px', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', letterSpacing: '0.04em' }}>
              toggle on to proxy webhooks to your dev server.
            </div>
          )}
        </div>
      )}
    </div>
  )
}
