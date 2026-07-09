import { useState, useEffect } from 'react'
import { rc } from '../styles.js'

const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE']

/**
 * Editor for an inbox's capture allowlist. The filter is an allowlist: a
 * request is logged only when it satisfies every constrained dimension
 * (AND across methods / paths / headers / query) and any one entry within a
 * dimension (OR). A request that matches nothing is still answered normally
 * (mock / forward / ack) but is not captured and consumes no quota.
 *
 * The empty filter (no constrained dimension) means "capture everything" —
 * saving it clears the filter server-side.
 */
export default function CaptureFilterPanel({ token, value, onRequestSave, onRequestClear, busy }) {
  const [draft, setDraft]     = useState(() => toDraft(value))
  const [editing, setEditing] = useState(false)

  useEffect(() => {
    setDraft(toDraft(value))
  }, [value])

  const active = Boolean(value) || editing

  function enableNow() {
    setDraft(toDraft(null))
    setEditing(true)
  }

  function disableNow() {
    onRequestClear?.()
    setEditing(false)
  }

  function save() {
    onRequestSave?.(fromDraft(draft))
    setEditing(false)
  }

  function cancel() {
    setDraft(toDraft(value))
    setEditing(false)
  }

  function toggleMethod(m) {
    setDraft(d => ({
      ...d,
      methods: d.methods.includes(m) ? d.methods.filter(x => x !== m) : [...d.methods, m],
    }))
  }

  const summary = describe(value)

  return (
    <div style={rc.section}>
      <div style={rc.sectionHead}>
        <span style={rc.sectionTitle}>capture filter</span>
        <StatusPill active={Boolean(value)} summary={summary} />
      </div>

      <button
        type="button"
        onClick={active ? disableNow : enableNow}
        className="sb-switchrow"
        style={rc.switchRow}
        aria-pressed={active}
      >
        <span>
          <span style={rc.switchRowLabel}>allowlist</span>
          <div style={rc.switchHint}>
            {active
              ? 'on — only matching requests are logged; the rest still get a reply but are dropped'
              : 'off — every incoming request is captured'}
          </div>
        </span>
        <span style={{ ...rc.switchTrack, ...(active ? rc.switchTrackOn : {}) }}>
          <span style={{ ...rc.switchThumb, ...(active ? rc.switchThumbOn : {}) }} />
        </span>
      </button>

      {active && (
        <div style={rc.card}>
          {/* methods */}
          <div style={rc.field}>
            <label style={rc.label}>methods</label>
            <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
              {METHODS.map(m => {
                const on = draft.methods.includes(m)
                return (
                  <button
                    key={m}
                    type="button"
                    onClick={() => toggleMethod(m)}
                    style={{
                      ...(on ? rc.btnPrimary : rc.btnGhost),
                      padding: '6px 12px',
                      fontFamily: 'var(--font-mono)',
                      fontSize: '11px',
                    }}
                  >
                    {m}
                  </button>
                )
              })}
            </div>
            <div style={rc.switchHint}>none selected = any method</div>
          </div>

          {/* paths */}
          <ListEditor
            label="paths"
            hint="glob — * matches anything, e.g. /webhooks/stripe or /api/*"
            rows={draft.paths}
            onChange={paths => setDraft(d => ({ ...d, paths }))}
            makeEmpty={() => ''}
            renderRow={(row, set) => (
              <input
                style={rc.input}
                value={row}
                placeholder="/webhooks/stripe"
                spellCheck={false}
                autoComplete="off"
                onChange={e => set(e.target.value)}
              />
            )}
          />

          {/* headers */}
          <ListEditor
            label="headers"
            hint="name required · value optional (empty = header just present)"
            rows={draft.headers}
            onChange={headers => setDraft(d => ({ ...d, headers }))}
            makeEmpty={() => ({ name: '', value: '' })}
            renderRow={(row, set) => <KeyValueRow row={row} set={set} namePlaceholder="x-event-type" />}
          />

          {/* query */}
          <ListEditor
            label="query params"
            hint="name required · value optional (empty = param just present)"
            rows={draft.query}
            onChange={query => setDraft(d => ({ ...d, query }))}
            makeEmpty={() => ({ name: '', value: '' })}
            renderRow={(row, set) => <KeyValueRow row={row} set={set} namePlaceholder="type" />}
          />

          <div style={rc.btnRow}>
            <button type="button" onClick={save} disabled={busy} className="sb-accent" style={rc.btnPrimary}>
              save
            </button>
            <button type="button" onClick={cancel} disabled={busy} style={rc.btnGhost}>
              cancel
            </button>
            <button
              type="button"
              onClick={disableNow}
              disabled={busy}
              style={{ ...rc.btnGhost, color: 'var(--status-red)' }}
            >
              clear filter
            </button>
          </div>
        </div>
      )}

      {!active && (
        <div style={{ fontSize: '12px', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', letterSpacing: '0.04em' }}>
          toggle on to only log requests to specific endpoints.
        </div>
      )}
    </div>
  )
}

function KeyValueRow({ row, set, namePlaceholder }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', flex: 1 }}>
      <input
        style={rc.input}
        value={row.name}
        placeholder={namePlaceholder}
        spellCheck={false}
        autoComplete="off"
        onChange={e => set({ ...row, name: e.target.value })}
      />
      <input
        style={rc.input}
        value={row.value ?? ''}
        placeholder="(any value)"
        spellCheck={false}
        autoComplete="off"
        onChange={e => set({ ...row, value: e.target.value })}
      />
    </div>
  )
}

function ListEditor({ label, hint, rows, onChange, makeEmpty, renderRow }) {
  function setAt(i, next) {
    onChange(rows.map((r, idx) => (idx === i ? next : r)))
  }
  function removeAt(i) {
    onChange(rows.filter((_, idx) => idx !== i))
  }
  function add() {
    onChange([...rows, makeEmpty()])
  }
  return (
    <div style={rc.field}>
      <label style={rc.label}>{label}</label>
      {rows.map((row, i) => (
        <div key={i} style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          {renderRow(row, next => setAt(i, next))}
          <button
            type="button"
            onClick={() => removeAt(i)}
            style={{ ...rc.btnGhost, padding: '6px 10px', color: 'var(--status-red)' }}
            aria-label={`remove ${label} rule`}
          >
            ✕
          </button>
        </div>
      ))}
      <button
        type="button"
        onClick={add}
        style={{ ...rc.btnGhost, alignSelf: 'flex-start', padding: '6px 12px', fontFamily: 'var(--font-mono)', fontSize: '11px' }}
      >
        + add {label}
      </button>
      <div style={rc.switchHint}>{hint}</div>
    </div>
  )
}

function StatusPill({ active, summary }) {
  if (active) {
    return (
      <span style={rc.pillOn}>
        <span style={rc.pillOnDot} />
        {summary}
      </span>
    )
  }
  return <span style={rc.pillOff}>off · capturing all</span>
}

// ---- draft <-> filter mapping ------------------------------------------

function toDraft(value) {
  return {
    methods: Array.isArray(value?.methods) ? [...value.methods] : [],
    paths:   Array.isArray(value?.paths)   ? [...value.paths]   : [],
    headers: Array.isArray(value?.headers) ? value.headers.map(h => ({ name: h.name, value: h.value ?? '' })) : [],
    query:   Array.isArray(value?.query)   ? value.query.map(q => ({ name: q.name, value: q.value ?? '' }))   : [],
  }
}

/**
 * Collapse a draft into the wire shape: drop blank rows, and omit a value
 * key when it is empty (a name-only rule matches on mere presence). Empty
 * dimensions are omitted entirely; an all-empty filter is `null` — which the
 * server treats as "capture everything" (i.e. clear the filter).
 */
function fromDraft(draft) {
  const out = {}
  if (draft.methods.length > 0) out.methods = draft.methods
  const paths = draft.paths.map(p => p.trim()).filter(Boolean)
  if (paths.length > 0) out.paths = paths
  const kv = list => list
    .map(r => ({ name: (r.name || '').trim(), value: (r.value || '').trim() }))
    .filter(r => r.name)
    .map(r => (r.value ? { name: r.name, value: r.value } : { name: r.name }))
  const headers = kv(draft.headers)
  if (headers.length > 0) out.headers = headers
  const query = kv(draft.query)
  if (query.length > 0) out.query = query
  return Object.keys(out).length === 0 ? null : out
}

function describe(value) {
  if (!value) return 'off'
  const parts = []
  if (value.methods?.length) parts.push(`${value.methods.length}m`)
  if (value.paths?.length)   parts.push(`${value.paths.length}p`)
  if (value.headers?.length) parts.push(`${value.headers.length}h`)
  if (value.query?.length)   parts.push(`${value.query.length}q`)
  return `on · ${parts.join(' ')}`
}
