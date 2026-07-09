import { useState, useEffect } from 'react'
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

const DELAY_MAX = 30000

function makeDraft(value) {
  if (!value) return { ...RESPONSE_DEFAULTS, body: '', delayMs: 0, scriptEnabled: false, script: '' }
  return {
    enabled:       Boolean(value.enabled),
    status:        value.status        ?? 200,
    contentType:   value.contentType   ?? 'application/json',
    body:          value.body          ?? '',
    delayMs:       value.delayMs        ?? 0,
    scriptEnabled: Boolean(value.scriptEnabled),
    script:        value.script        ?? '',
  }
}

function isDirty(draft, value) {
  if (!value) {
    return draft.body !== '' || draft.delayMs > 0 || draft.scriptEnabled || draft.script !== ''
  }
  return (
    draft.status !== value.status ||
    draft.contentType !== value.contentType ||
    draft.body !== value.body ||
    draft.delayMs !== (value.delayMs || 0) ||
    draft.scriptEnabled !== Boolean(value.scriptEnabled) ||
    draft.script !== (value.script || '')
  )
}

function clampDelay(raw) {
  const n = Math.floor(Number(raw))
  if (!Number.isFinite(n) || n < 0) return 0
  return Math.min(n, DELAY_MAX)
}

export default function ResponseConfigPanel({ token, value, onRequestSave, onRequestClear, busy }) {
  const [draft, setDraft]   = useState(() => makeDraft(value))
  const [editing, setEditing] = useState(false)
  const [error, setError]   = useState(null)

  useEffect(() => {
    setDraft(makeDraft(value))
    setError(null)
  }, [value])

  function patch(p) {
    setDraft(d => ({ ...d, ...p }))
  }

  function save() {
    setError(null)
    const config = {
      enabled: true,
      status:  Number(draft.status),
      contentType: draft.contentType,
      body: draft.body,
      delayMs: clampDelay(draft.delayMs),
      scriptEnabled: draft.scriptEnabled,
      script: draft.script.slice(0, SCRIPT_MAX),
    }
    onRequestSave?.(config)
    setEditing(false)
  }

  function cancel() {
    setDraft(makeDraft(value))
    setError(null)
    setEditing(false)
  }

  function enableNow() {
    setDraft(makeDraft(null))
    setError(null)
    setEditing(true)
  }

  function disableNow() {
    setError(null)
    onRequestClear?.()
    setEditing(false)
  }

  const scriptOver = draft.script.length > SCRIPT_MAX
  const active = Boolean(value?.enabled) || editing
  const dirty = isDirty(draft, value)

  return (
    <div style={rc.section}>
      <div style={rc.sectionHead}>
        <span style={rc.sectionTitle}>response</span>
        <StatusPill rs={editing ? draft : value} />
      </div>

      <button
        type="button"
        onClick={active ? disableNow : enableNow}
        className="sb-switchrow"
        style={rc.switchRow}
        aria-pressed={active}
      >
        <span>
          <span style={rc.switchRowLabel}>custom reply</span>
          <div style={rc.switchHint}>
            {active
              ? 'on — your reply is returned to webhook senders'
              : 'off — toggle on to configure one'}
          </div>
        </span>
        <span style={{ ...rc.switchTrack, ...(active ? rc.switchTrackOn : {}) }}>
          <span style={{ ...rc.switchThumb, ...(active ? rc.switchThumbOn : {}) }} />
        </span>
      </button>

      {active && (
        <div style={rc.card}>
          <div style={rc.fieldRow}>
            <div style={rc.field}>
              <label style={rc.label}>status</label>
              <select
                value={draft.status}
                onChange={e => patch({ status: Number(e.target.value) })}
                style={rc.select}
              >
                {RESPONSE_PRESETS.status.map(p => (
                  <option key={p.v} value={p.v}>{p.l}</option>
                ))}
              </select>
            </div>
            <div style={rc.field}>
              <label style={rc.label}>content-type</label>
              <select
                value={draft.contentType}
                onChange={e => patch({ contentType: e.target.value })}
                style={rc.select}
              >
                {RESPONSE_PRESETS.contentType.map(p => (
                  <option key={p.v} value={p.v}>{p.l}</option>
                ))}
              </select>
            </div>
          </div>

          <div style={rc.field}>
            <label style={rc.label}>body · static fallback</label>
            <textarea
              value={draft.body}
              onChange={e => patch({ body: e.target.value })}
              placeholder='{"ok":true}'
              spellCheck={false}
              style={rc.textarea}
            />
          </div>

          <div style={rc.field}>
            <label style={rc.label}>delay · simulate a slow upstream (ms)</label>
            <input
              type="number"
              min={0}
              max={DELAY_MAX}
              step={100}
              value={draft.delayMs}
              onChange={e => patch({ delayMs: e.target.value })}
              onBlur={e => patch({ delayMs: clampDelay(e.target.value) })}
              placeholder="0"
              style={rc.select}
            />
            <div style={rc.switchHint}>
              {draft.delayMs > 0
                ? `holds the reply ${clampDelay(draft.delayMs)}ms before responding · max ${DELAY_MAX}`
                : 'reply immediately · raise to test client timeout + retry logic'}
            </div>
          </div>

          <button
            type="button"
            onClick={() => patch({ scriptEnabled: !draft.scriptEnabled })}
            className="sb-switchrow"
            style={rc.switchRow}
            aria-pressed={draft.scriptEnabled}
          >
            <span>
              <span style={rc.switchRowLabel}>js script</span>
              <div style={rc.switchHint}>overrides body · 200ms timeout · sandboxed</div>
            </span>
            <span style={{ ...rc.switchTrack, ...(draft.scriptEnabled ? rc.switchTrackOn : {}) }}>
              <span style={{ ...rc.switchThumb, ...(draft.scriptEnabled ? rc.switchThumbOn : {}) }} />
            </span>
          </button>

          {draft.scriptEnabled && (
            <div style={rc.field}>
              <label style={rc.label}>script source</label>
              <textarea
                value={draft.script}
                onChange={e => patch({ script: e.target.value.slice(0, SCRIPT_MAX + 256) })}
                placeholder={SCRIPT_DEFAULT}
                spellCheck={false}
                style={{
                  ...rc.textarea,
                  minHeight: '200px',
                  borderColor: scriptOver ? 'var(--status-red)' : c.border,
                }}
              />
              <div style={scriptOver ? rc.scriptCountOver : rc.scriptCount}>
                {draft.script.length}/{SCRIPT_MAX}
              </div>
            </div>
          )}

          <div style={rc.btnRow}>
            <button
              type="button"
              onClick={save}
              disabled={busy || scriptOver}
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
              clear reply
            </button>
          </div>

          {error && <div style={rc.error}>{error}</div>}
        </div>
      )}

      {!active && (
        <div style={{ fontSize: '12px', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', letterSpacing: '0.04em' }}>
          toggle on to configure a custom reply, or use forward below to proxy webhooks.
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
  if (rs && (rs.status || rs.contentType)) {
    return (
      <span style={rc.pillOn} title="custom reply preview">
        <span style={rc.pillOnDot} />
        custom · {rs.status || 200}
      </span>
    )
  }
  return <span style={rc.pillOff}>default · 200</span>
}