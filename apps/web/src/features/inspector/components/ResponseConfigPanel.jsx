import { useState, useEffect } from 'react'
import { api } from '../../../lib/api.js'
import { c } from '../lib/tokens.js'
import { RESPONSE_PRESETS, RESPONSE_DEFAULTS } from '../lib/responsePresets.js'
import { rc } from '../styles.js'

const SCRIPT_MAX = 8192
const SCRIPT_DEFAULT = `// runs in a sandboxed node:vm context
// 'request' is available with { method, path, query, headers, body }
// return a string to send as the response body

return JSON.stringify({
  echo: request.body,
  method: request.method,
  stamped_at: new Date().toISOString()
});
`

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
    <div style={rc.section}>
      <div style={rc.sectionHead}>
        <span style={rc.sectionTitle}>response</span>
        {!loading && <StatusPill rs={saved} />}
      </div>

      <button
        type="button"
        onClick={() => setEnabled(e => !e)}
        className="sb-switchrow"
        style={rc.switchRow}
        aria-pressed={enabled}
      >
        <span>
          <span style={rc.switchRowLabel}>custom reply</span>
          <div style={rc.switchHint}>{enabled ? 'on — your script or body is returned' : 'off — default 200 ok'}</div>
        </span>
        <span style={{ ...rc.switchTrack, ...(enabled ? rc.switchTrackOn : {}) }}>
          <span style={{ ...rc.switchThumb, ...(enabled ? rc.switchThumbOn : {}) }} />
        </span>
      </button>

      {enabled && (
        <div style={rc.card}>
          <div style={rc.fieldRow}>
            <div style={rc.field}>
              <label style={rc.label}>status</label>
              <select value={status} onChange={e => setStatus(Number(e.target.value))} style={rc.select}>
                {RESPONSE_PRESETS.status.map(p => (
                  <option key={p.v} value={p.v}>{p.l}</option>
                ))}
              </select>
            </div>
            <div style={rc.field}>
              <label style={rc.label}>content-type</label>
              <select value={contentType} onChange={e => setCT(e.target.value)} style={rc.select}>
                {RESPONSE_PRESETS.contentType.map(p => (
                  <option key={p.v} value={p.v}>{p.l}</option>
                ))}
              </select>
            </div>
          </div>

          <div style={rc.field}>
            <label style={rc.label}>body · static fallback</label>
            <textarea
              value={body}
              onChange={e => setBody(e.target.value)}
              placeholder='{"ok":true}'
              spellCheck={false}
              style={rc.textarea}
            />
          </div>

          <button
            type="button"
            onClick={() => setScriptEnabled(s => !s)}
            className="sb-switchrow"
            style={rc.switchRow}
            aria-pressed={scriptEnabled}
          >
            <span>
              <span style={rc.switchRowLabel}>js script</span>
              <div style={rc.switchHint}>overrides body · 200ms timeout · sandboxed</div>
            </span>
            <span style={{ ...rc.switchTrack, ...(scriptEnabled ? rc.switchTrackOn : {}) }}>
              <span style={{ ...rc.switchThumb, ...(scriptEnabled ? rc.switchThumbOn : {}) }} />
            </span>
          </button>

          {scriptEnabled && (
            <div style={rc.field}>
              <label style={rc.label}>script source</label>
              <textarea
                value={script}
                onChange={e => setScript(e.target.value.slice(0, SCRIPT_MAX + 256))}
                placeholder={SCRIPT_DEFAULT}
                spellCheck={false}
                style={{
                  ...rc.textarea,
                  minHeight: '200px',
                  borderColor: scriptOver ? 'var(--status-red)' : c.border,
                }}
              />
              <div style={scriptOver ? rc.scriptCountOver : rc.scriptCount}>
                {script.length}/{SCRIPT_MAX}
              </div>
            </div>
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
        </div>
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