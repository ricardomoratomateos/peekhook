import { useState, useEffect } from 'react'
import { api } from '../../../lib/api.js'
import { c } from '../lib/tokens.js'
import { RESPONSE_PRESETS, RESPONSE_DEFAULTS } from '../lib/responsePresets.js'
import { rc } from '../styles.js'

export default function ResponseConfigPanel({ token }) {
  const [saved, setSaved]         = useState(null)
  const [loading, setLoading]     = useState(true)
  const [enabled, setEnabled]     = useState(false)
  const [status, setStatus]       = useState(200)
  const [contentType, setCT]      = useState('application/json')
  const [body, setBody]           = useState('')
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
      const cfg = { enabled, status: Number(status), contentType, body }
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
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

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

              <label style={rc.label}>body</label>
              <textarea
                value={body}
                onChange={e => setBody(e.target.value)}
                placeholder='{"ok":true}'
                spellCheck={false}
                style={rc.textarea}
              />

              <div style={rc.btnRow}>
                <button onClick={handleSave} disabled={saving} className="sb-accent" style={rc.btnPrimary}>
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
