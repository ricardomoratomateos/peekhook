import { useState, useEffect } from 'react'
import { api } from '../../../lib/api.js'
import { c } from '../lib/tokens.js'
import { RESPONSE_PRESETS, RESPONSE_DEFAULTS } from '../lib/responsePresets.js'
import { rc } from '../styles.js'

const SCRIPT_MAX = 8192
const SCRIPT_DEFAULT = `// runs in a sandboxed node:vm context\n// 'request' is available with { method, path, query, headers, body }\n// return a string to send as the response body\n\nreturn JSON.stringify({\n  echo: request.body,\n  method: request.method,\n  stamped_at: new Date().toISOString()\n});\n`

export default function ResponseConfigPanel({ token }) {
  const [saved, setSaved]         = useState(null)
  const [loading, setLoading]     = useState(true)
  const [enabled, setEnabled]     = useState(false)
  const [status, setStatus]       = useState(200)
  const [contentType, setCT]      = useState('application/json')
  const [body, setBody]           = useState('')
  const [scriptEnabled, setScriptEnabled] = useState(false)
  const [script, setScript]       = useState('')
  const [saving, setSaving]       = useState(false)
  const [error, setError]         = useState(null)
  const [open, setOpen]           = useState(false)

  useEffect(() => {
    let cancelled = false
    api.getInbox(token)
      .then(inbox => {
        if (cancelled) return
        if (inbox.responseConfig) {
          setSaved(inbox.responseConfig)
          setEnabled(inbox.responseConfig.enabled)
          setStatus(inbox.responseConfig.status)
          setCT(inbox.responseConfig.contentType)
          setBody(inbox.responseConfig.body)
          setScriptEnabled(Boolean(inbox.responseConfig.scriptEnabled))
          setScript(inbox.responseConfig.script || '')
        }
      })
      .catch(() => {})
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [token])

  async function handleSave() {
    setError(null)
    setSaving(true)
    try {
      const cfg = {
        enabled,
        status: Number(status),
        contentType,
        body,
        scriptEnabled,
        script: script.slice(0, SCRIPT_MAX),
      }
      const updated = await api.setResponse(token, cfg)
      setSaved(updated.responseConfig)
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  async function handleClear() {
    setError(null)
    setSaving(true)
    try {
      await api.clearResponse(token)
      setSaved(null)
      setEnabled(false)
      setStatus(RESPONSE_DEFAULTS.status)
      setCT(RESPONSE_DEFAULTS.contentType)
      setBody(RESPONSE_DEFAULTS.body)
      setScriptEnabled(false)
      setScript('')
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  const scriptOver = script.length > SCRIPT_MAX

  return (
    <div style={{ ...rc.wrap, padding: open ? '12px' : '5px 12px', gap: open ? '8px' : '0' }}>
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="sb-replybtn"
        style={rc.headBtn}
        aria-expanded={open}
      >
        <span style={rc.headLeft}>
          <span style={rc.title}>reply</span>
          {!loading && <StatusPill rs={saved} />}
        </span>
        <span className="material-symbols-outlined" style={rc.chev}>
          {open ? 'expand_less' : 'expand_more'}
        </span>
      </button>

      {open && (
        <>
          <button
            type="button"
            onClick={() => setEnabled(e => !e)}
            className="sb-switchrow"
            style={rc.switchRow}
            aria-pressed={enabled}
          >
            <span style={rc.switchRowLabel}>use custom reply</span>
            <span style={{ ...rc.switchTrack, ...(enabled ? rc.switchTrackOn : {}) }}>
              <span style={{ ...rc.switchThumb, ...(enabled ? rc.switchThumbOn : {}) }} />
            </span>
          </button>

          {enabled && (
            <>
              <label style={rc.label}>status</label>
              <select value={status} onChange={e => setStatus(Number(e.target.value))} style={rc.select}>
                {RESPONSE_PRESETS.status.map(p => (
                  <option key={p.v} value={p.v}>{p.l}</option>
                ))}
              </select>

              <label style={rc.label}>content-type</label>
              <select value={contentType} onChange={e => setCT(e.target.value)} style={rc.select}>
                {RESPONSE_PRESETS.contentType.map(p => (
                  <option key={p.v} value={p.v}>{p.l}</option>
                ))}
              </select>

              <label style={rc.label}>body (static fallback)</label>
              <textarea
                value={body}
                onChange={e => setBody(e.target.value)}
                placeholder='{"ok":true}'
                spellCheck={false}
                style={rc.textarea}
              />

              <button
                type="button"
                onClick={() => setScriptEnabled(s => !s)}
                className="sb-switchrow"
                style={{ ...rc.switchRow, marginTop: '4px' }}
                aria-pressed={scriptEnabled}
              >
                <span style={rc.switchRowLabel}>use js script (override body)</span>
                <span style={{ ...rc.switchTrack, ...(scriptEnabled ? rc.switchTrackOn : {}) }}>
                  <span style={{ ...rc.switchThumb, ...(scriptEnabled ? rc.switchThumbOn : {}) }} />
                </span>
              </button>

              {scriptEnabled && (
                <>
                  <label style={rc.label}>script · 200ms timeout · sandboxed</label>
                  <textarea
                    value={script}
                    onChange={e => setScript(e.target.value.slice(0, SCRIPT_MAX + 256))}
                    placeholder={SCRIPT_DEFAULT}
                    spellCheck={false}
                    style={{
                      ...rc.textarea,
                      minHeight: '120px',
                      borderColor: scriptOver ? 'var(--status-red)' : c.border,
                    }}
                  />
                  <div style={{
                    fontFamily: c.mono, fontSize: '10px',
                    color: scriptOver ? 'var(--status-red)' : c.faint,
                    marginTop: '2px',
                    textAlign: 'right',
                  }}>
                    {script.length}/{SCRIPT_MAX}
                  </div>
                </>
              )}

              <div style={rc.btnRow}>
                <button
                  onClick={handleSave}
                  disabled={saving || scriptOver}
                  className="sb-accent"
                  style={rc.btnPrimary}
                >
                  {saving ? 'saving…' : 'save'}
                </button>
                <button onClick={handleClear} disabled={saving} style={rc.btnGhost}>
                  reset
                </button>
              </div>

              {error && <div style={rc.error}>{error}</div>}
            </>
          )}
        </>
      )}
    </div>
  )
}

function StatusPill({ rs }) {
  if (rs?.enabled && rs?.scriptEnabled && rs?.script) {
    return (
      <span style={rc.pillOn} title="scripted reply active">
        <span style={rc.pillOnDot} />
        script · {rs.status}
      </span>
    )
  }
  if (rs?.enabled) {
    return (
      <span style={rc.pillOn} title="custom reply active">
        <span style={rc.pillOnDot} />
        custom · {rs.status}
      </span>
    )
  }
  return <span style={rc.pillOff}>default · 200</span>
}
