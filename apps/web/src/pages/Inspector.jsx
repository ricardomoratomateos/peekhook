import { useEffect, useState, useRef } from 'react'
import { useParams, useLocation, Link } from 'react-router-dom'
import { api } from '../lib/api.js'

// Monochrome canvas + single electric-lime accent — sourced from the global
// design tokens (globals.css) so this page tracks the system, not a parallel
// copy. `lowest` stays pure black for max code-block contrast.
const c = {
  bg: 'var(--bg)',
  lowest: '#000000',
  low: 'var(--surface)',
  ctr: 'var(--surface-2)',
  high: 'var(--surface-3)',
  fg: 'var(--text-strong)',
  dim: 'var(--text-body)',
  faint: 'var(--text-muted)',
  outline: 'var(--border-strong)',
  border: 'var(--border-strong)',
  borderSoft: 'var(--border)',
  accent: 'var(--accent)',
  accentInk: 'var(--accent-ink)',
  accentBg: 'var(--green-10)',
  sans: 'var(--font-sans)',
  mono: 'var(--font-mono)',
}

const GRAIN = "data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E"

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function timeAgo(date) {
  if (!date) return '—'
  const sec = Math.floor((Date.now() - new Date(date)) / 1000)
  if (sec < 5) return 'just now'
  if (sec < 60) return `${sec}s ago`
  if (sec < 3600) return `${Math.floor(sec / 60)}m ago`
  if (sec < 86400) return `${Math.floor(sec / 3600)}h ago`
  return new Date(date).toLocaleDateString()
}

function formatSize(bytes) {
  if (!bytes && bytes !== 0) return '—'
  if (bytes === 0) return '0 B'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function methodTone(method) {
  return ['POST', 'PUT', 'PATCH', 'DELETE'].includes((method || '').toUpperCase())
    ? { color: c.fg, weight: 500 }
    : { color: c.dim, weight: 400 }
}

function formatBody(body, contentType) {
  if (body == null || body === '') return null
  const ct = (contentType || '').toLowerCase()
  if (ct.includes('json')) {
    if (typeof body === 'object') return JSON.stringify(body, null, 2)
    try { return JSON.stringify(JSON.parse(body), null, 2) } catch (_) {}
  }
  if (typeof body === 'object') return JSON.stringify(body, null, 2)
  return String(body)
}

// Captured `path` is the raw ingest path (/i/<token>/...). Show only what the
// sender appended after the inbox, webhook.site-style.
function prettyPath(path, token) {
  if (!path) return '/'
  const prefix = `/i/${token}`
  if (path.startsWith(prefix)) return path.slice(prefix.length) || '/'
  return path
}

function resolveInboxUrl(token, state) {
  if (state?.url) return state.url
  try {
    const stored = JSON.parse(localStorage.getItem(`peekhook-${token}`) || '{}')
    if (stored.url) return stored.url
  } catch (_) {}
  const apiBase = import.meta.env.VITE_API_URL || ''
  return apiBase ? `${apiBase}/i/${token}` : `/i/${token}`
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function MethodChip({ method }) {
  const t = methodTone(method)
  return (
    <span style={{
      display: 'inline-block', padding: '2px 6px', borderRadius: '4px',
      border: `1px solid ${c.border}`, color: t.color, fontWeight: t.weight,
      fontSize: '10px', letterSpacing: '0.04em', flexShrink: 0, fontFamily: c.mono,
    }}>
      {(method || '?').toLowerCase()}
    </span>
  )
}

function LiveBadge({ status }) {
  const map = {
    connecting: { label: 'connecting', color: c.faint, dot: c.faint, pulse: true },
    live:       { label: 'live',       color: c.dim,   dot: c.accent, pulse: true },
    polling:    { label: 'polling',    color: c.faint, dot: c.faint, pulse: false },
    error:      { label: 'offline',    color: c.faint, dot: c.faint, pulse: false },
  }
  const { label, color, dot, pulse } = map[status] || map.connecting
  return (
    <span style={{ display: 'flex', alignItems: 'center', gap: '7px', fontFamily: c.mono, fontSize: '11px', color, letterSpacing: '0.12em' }}>
      <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: dot, flexShrink: 0, animation: pulse ? 'sbpulse 2s ease infinite' : 'none' }} />
      {label}
    </span>
  )
}

function RequestRow({ req, token, selected, isNew, onClick }) {
  return (
    <button
      onClick={onClick}
      className={`sb-reqrow${selected ? ' sb-reqrow-active' : ''}`}
      style={{
        display: 'flex', alignItems: 'center', gap: '10px', padding: '9px 12px',
        borderRadius: '8px', background: selected ? c.accentBg : 'transparent',
        border: 'none', cursor: 'pointer', width: '100%', textAlign: 'left', fontFamily: c.mono,
        animation: isNew ? 'sbfade .3s ease' : 'none', transition: 'background .12s, color .12s',
      }}
      aria-pressed={selected}
    >
      <span className="material-symbols-outlined sb-reqicon" style={{ fontSize: '18px', color: selected ? c.accent : c.faint, flexShrink: 0, transition: 'color .12s' }}>bolt</span>
      <MethodChip method={req.method} />
      <span style={{ flex: 1, fontSize: '12px', color: selected ? c.fg : c.dim, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 }}>
        {prettyPath(req.path, token)}
      </span>
      <span style={{ fontSize: '11px', color: c.faint, flexShrink: 0 }}>{timeAgo(req.createdAt)}</span>
    </button>
  )
}

function KVTable({ rows }) {
  if (!rows || rows.length === 0) return <span style={{ fontSize: '12px', color: c.faint }}>none</span>
  return (
    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px' }}>
      <tbody>
        {rows.map(([k, v]) => (
          <tr key={k} style={{ borderBottom: `1px solid ${c.borderSoft}` }}>
            <td style={{ padding: '5px 0', color: c.faint, width: '38%', verticalAlign: 'top', paddingRight: '12px', whiteSpace: 'nowrap', fontFamily: c.mono }}>{k}</td>
            <td style={{ padding: '5px 0', color: c.dim, wordBreak: 'break-all', fontFamily: c.mono }}>{Array.isArray(v) ? v.join(', ') : String(v)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

function Meta({ label, value }) {
  return (
    <span style={d.metaItem}>
      <span style={d.metaLabel}>{label}</span>
      <span style={d.metaVal}>{value}</span>
    </span>
  )
}

function DetailPanel({ req, token }) {
  if (!req) {
    return (
      <div style={d.noSel}>
        <p style={d.noSelText}>select a request to inspect</p>
        <p style={d.noSelSub}>click any request in the list to view its headers and body.</p>
      </div>
    )
  }
  const t = methodTone(req.method)
  const bodyText = formatBody(req.body, req.contentType)
  const queryRows = req.query && typeof req.query === 'object' ? Object.entries(req.query) : []
  const headerRows = req.headers ? Object.entries(req.headers) : []

  return (
    <div style={d.panel}>
      <div style={d.header}>
        <div style={d.headerLeft}>
          <div style={d.eyebrow}>sandbox · inbox</div>
          <div style={d.headlineRow}>
            <span style={{ ...d.methodLg, color: t.color, fontWeight: t.weight }}>{(req.method || '?').toLowerCase()}</span>
            <span style={d.pathLg}>{prettyPath(req.path, token)}</span>
          </div>
        </div>
        <span style={d.timestamp}>{new Date(req.createdAt).toISOString().replace('T', ' ').slice(0, 19)}</span>
      </div>

      <div style={d.meta}>
        {req.ip && <Meta label="ip" value={req.ip} />}
        {req.contentType && <Meta label="content-type" value={req.contentType} />}
        {req.size != null && <Meta label="size" value={formatSize(req.size)} />}
      </div>

      <div style={d.scroll}>
        {queryRows.length > 0 && (
          <section style={d.section}>
            <div style={d.sectionTitle}>query params</div>
            <KVTable rows={queryRows} />
          </section>
        )}
        <section style={d.section}>
          <div style={d.sectionTitle}>headers</div>
          <KVTable rows={headerRows} />
        </section>
        <section style={{ ...d.section, flex: 1, display: 'flex', flexDirection: 'column', borderBottom: 'none' }}>
          <div style={d.sectionTitle}>body</div>
          {bodyText ? <pre style={d.bodyPre}>{bodyText}</pre> : <span style={{ fontSize: '12px', color: c.faint }}>empty body</span>}
        </section>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// ResponseConfigPanel — sidebar section that lets the user configure what
// the open ingest endpoint replies to incoming requests. Mints a default
// 200 acknowledgement when off; applies status/content-type/body when on.
// ---------------------------------------------------------------------------

const RESPONSE_PRESETS = {
  status: [
    { v: 200, l: '200 ok' },
    { v: 201, l: '201 created' },
    { v: 400, l: '400 bad request' },
    { v: 401, l: '401 unauthorized' },
    { v: 403, l: '403 forbidden' },
    { v: 404, l: '404 not found' },
    { v: 422, l: '422 unprocessable' },
    { v: 429, l: '429 rate limited' },
    { v: 500, l: '500 server error' },
    { v: 502, l: '502 bad gateway' },
    { v: 503, l: '503 unavailable' },
  ],
  contentType: [
    { v: 'application/json',  l: 'json' },
    { v: 'text/plain',         l: 'text' },
  ],
}

const RESPONSE_DEFAULTS = { enabled: false, status: 200, contentType: 'application/json', body: '{"ok":true}' }

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

function ResponseConfigPanel({ token }) {
  const [saved, setSaved]         = useState(null)            // config currently persisted on the inbox (null = none)
  const [loading, setLoading]     = useState(true)
  const [enabled, setEnabled]     = useState(false)
  const [status, setStatus]       = useState(200)
  const [contentType, setCT]      = useState('application/json')
  const [body, setBody]           = useState('')
  const [saving, setSaving]       = useState(false)
  const [error, setError]         = useState(null)
  const [open, setOpen]           = useState(false)           // collapsed by default — keeps the sidebar slim for the request list

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
      {/* Always-visible header: shows the current reply state at a glance
          (custom · 401, default · 200) and toggles the form. Saves the
          sidebar from being eaten by a form users only need occasionally. */}
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
          {/* Single switch: toggle custom mode on/off. Replaces the
              default/custom segmented pair — collapsed into one control
              since the pill in the header already conveys current state. */}
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

// Soft skeleton bar — reuses the global wg-pulse keyframe so it matches
// dashboard + admin. Stops the "waiting for requests…" empty state from
// flashing while the SSE stream is still connecting.
function Sk({ w = '100%', h = 12, style = {} }) {
  return <span className="wg-skel" style={{ display: 'inline-block', width: w, height: h, background: c.ctr, borderRadius: '4px', ...style }} />
}

function ConnectingState() {
  return (
    <div style={d.emptyWrap}>
      <div style={d.emptyContent}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '14px' }}>
          <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: c.accent, animation: 'sbpulse 2s ease infinite' }} />
          <span style={{ fontFamily: c.mono, fontSize: '11px', color: c.faint, letterSpacing: '0.2em', textTransform: 'uppercase' }}>connecting…</span>
        </div>
        <div style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: '10px' }}>
          <Sk h={18} w="40%" />
          <Sk h={12} w="75%" />
          <Sk h={12} w="60%" />
          <Sk h={12} w="68%" />
          <Sk h={12} w="52%" />
        </div>
      </div>
    </div>
  )
}

function buildTestCurl(inboxUrl) {
  return `curl -s -X POST ${inboxUrl || '<your-inbox-url>'} \\
  -H "content-type: application/json" \\
  -w "\\nHTTP %{http_code}\\n" \\
  -d '{"event":"test","hello":"world"}'`
}

function EmptyState({ inboxUrl, onCopy }) {
  const curl = buildTestCurl(inboxUrl)
  return (
    <div style={d.emptyWrap}>
      <div style={d.emptyContent}>
        <p style={d.emptyTitle}>waiting for requests…</p>
        <p style={d.emptySub}>send any http request to your inbox url and it appears here instantly.</p>
        <div style={d.curlBlock}>
          <div style={d.curlHead}>
            <span style={d.curlLabel}>example</span>
            <button
              type="button"
              onClick={onCopy}
              className="sb-copytest"
              style={d.curlCopyBtn}
              aria-label="copy example request"
            >
              <span className="material-symbols-outlined" style={{ fontSize: '13px' }}>content_copy</span>
              <span>copy</span>
            </button>
          </div>
          <pre style={d.curlCode}>{curl}</pre>
        </div>
        <div style={d.tips}>
          {[
            'any method works — get, post, put, delete, patch…',
            'all headers and body are captured',
            'json bodies are pretty-printed automatically',
          ].map(tip => <div key={tip} style={d.tip}>{tip}</div>)}
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

export default function Inspector() {
  const { token } = useParams()
  const { state } = useLocation()
  const inboxUrl = resolveInboxUrl(token, state)

  const [requests, setRequests] = useState([])
  const [selectedId, setSelectedId] = useState(null)
  const [copied, setCopied] = useState(false)
  const [copiedTest, setCopiedTest] = useState(false)
  const [liveStatus, setLiveStatus] = useState('connecting')
  const [notFound, setNotFound] = useState(false)
  const [newIds, setNewIds] = useState(new Set())
  const newIdsRef = useRef(new Set())

  const [, setTick] = useState(0)
  useEffect(() => {
    const t = setInterval(() => setTick(v => v + 1), 15_000)
    return () => clearInterval(t)
  }, [])

  useEffect(() => {
    let es = null
    let pollTimer = null
    let cancelled = false
    let sseConnected = false

    function addRequest(req) {
      if (!req?.id) return
      setRequests(prev => {
        if (prev.some(r => r.id === req.id)) return prev
        newIdsRef.current = new Set([...newIdsRef.current, req.id])
        setNewIds(new Set(newIdsRef.current))
        setTimeout(() => {
          newIdsRef.current.delete(req.id)
          setNewIds(new Set(newIdsRef.current))
        }, 2000)
        return [req, ...prev]
      })
    }

    function startPolling() {
      if (cancelled) return
      setLiveStatus('polling')
      const doFetch = () => {
        api.getRequests(token)
          .then(data => { if (!cancelled) setRequests(data) })
          .catch(err => { if (err.status === 404) setNotFound(true) })
      }
      doFetch()
      pollTimer = setInterval(doFetch, 2000)
    }

    api.getRequests(token)
      .then(data => { if (!cancelled) setRequests(data) })
      .catch(err => { if (err.status === 404 && !cancelled) setNotFound(true) })

    if (typeof EventSource !== 'undefined') {
      try {
        es = new EventSource(api.streamUrl(token))
        es.addEventListener('open', () => { sseConnected = true; if (!cancelled) setLiveStatus('live') })
        es.addEventListener('message', (evt) => {
          sseConnected = true
          if (cancelled) return
          try {
            const msg = JSON.parse(evt.data)
            if (msg.type === 'request' && msg.data) addRequest(msg.data)
          } catch (_) {}
        })
        es.addEventListener('error', () => {
          if (!sseConnected && !cancelled) {
            if (es) { es.close(); es = null }
            startPolling()
          }
        })
      } catch (_) { startPolling() }
    } else {
      startPolling()
    }

    return () => {
      cancelled = true
      if (es) { es.close(); es = null }
      clearInterval(pollTimer)
    }
  }, [token])

  // Auto-select the newest request so the detail panel is never an empty void.
  useEffect(() => {
    if (selectedId == null && requests.length > 0) setSelectedId(requests[0].id)
  }, [requests, selectedId])

  const selectedReq = requests.find(r => r.id === selectedId) || null

  async function handleCopy() {
    try { await navigator.clipboard.writeText(inboxUrl) } catch (_) {}
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  async function handleCopyTestRequest() {
    try { await navigator.clipboard.writeText(buildTestCurl(inboxUrl)) } catch (_) {}
    setCopiedTest(true)
    setTimeout(() => setCopiedTest(false), 1800)
  }

  if (notFound) {
    return (
      <div style={s.notFound}>
        <div style={s.grain} aria-hidden />
        <div style={s.notFoundInner}>
          <div style={s.notFoundCode}>404</div>
          <p style={s.notFoundTitle}>inbox not found</p>
          <p style={s.notFoundSub}>this inbox has expired or never existed. inboxes expire after 7 days.</p>
          <Link to="/" style={s.notFoundBtn}>get a new inbox url</Link>
        </div>
      </div>
    )
  }

  return (
    <>
      <style>{`
        @keyframes sbpulse { 0%,100% { opacity: 1; } 50% { opacity: 0.3; } }
        @keyframes sbfade { from { opacity: 0; transform: translateX(-4px); } to { opacity: 1; transform: translateX(0); } }
        .sb-link { transition: color .15s; }
        .sb-link:hover { color: ${c.fg} !important; }
        .sb-copy { transition: background .12s, color .12s; }
        .sb-copy:hover { background: ${c.high} !important; color: ${c.fg} !important; }
        .sb-accent { transition: background .12s, transform .12s; }
        .sb-accent:hover { background: #d4ff1a !important; transform: translateY(-1px); }
        .sb-reqrow:not(.sb-reqrow-active):hover { background: var(--surface-2) !important; }
        .sb-reqrow:not(.sb-reqrow-active):hover .sb-reqicon { color: var(--accent) !important; }
        .sb-replybtn:not([aria-expanded="true"]):hover { background: var(--surface-2) !important; border-radius: 4px; }
        .sb-replybtn:not([aria-expanded="true"]):hover .material-symbols-outlined { color: var(--accent) !important; }
        .sb-switchrow:hover { background: var(--surface-2) !important; border-radius: 4px; }
        .sb-copytest:hover { background: var(--surface-2) !important; color: var(--text-strong) !important; border-color: var(--border-strong) !important; }
      `}</style>

      <div style={s.shell}>
        <div style={s.grain} aria-hidden />

        {/* Sidebar — dashboard chrome */}
        <aside style={s.sidebar} aria-label="Sandbox inbox">
          <div style={s.logo}>
            <Link to="/" className="sb-link" style={s.logoText}>peekhook</Link>
          </div>

          <div style={s.ctxRow}>
            <span className="material-symbols-outlined" style={s.ctxIcon}>science</span>
            <span style={s.ctxName}>sandbox</span>
            <LiveBadge status={liveStatus} />
          </div>

          <div style={s.urlCard}>
            <span style={s.urlText} title={inboxUrl}>{inboxUrl}</span>
            <button onClick={handleCopy} className="sb-copy" style={s.copyBtn} aria-label={copied ? 'Copied' : 'Copy inbox URL'}>
              <span className="material-symbols-outlined" style={{ fontSize: '14px' }}>{copied ? 'check' : 'content_copy'}</span>
            </button>
          </div>

          <button
            type="button"
            onClick={handleCopyTestRequest}
            className="sb-copytest"
            style={s.copyTestBtn}
            aria-label={copiedTest ? 'Copied test request' : 'Copy a test request'}
          >
            <span className="material-symbols-outlined" style={{ fontSize: '14px' }}>
              {copiedTest ? 'check' : 'terminal'}
            </span>
            <span style={{ flex: 1 }}>{copiedTest ? 'copied' : 'copy a test request'}</span>
          </button>

          <ResponseConfigPanel token={token} />

          <div style={s.listHead}>
            <span style={s.listHeadLabel}>requests</span>
            {requests.length > 0 && <span style={s.listHeadCount}>{requests.length}</span>}
          </div>
          <div style={s.listRows}>
            {requests.length === 0 ? (
              <div style={s.listEmpty}>
                <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: c.accent, animation: 'sbpulse 2s ease infinite' }} />
                <span style={s.listEmptyText}>waiting for first request…</span>
              </div>
            ) : (
              requests.map(req => (
                <RequestRow
                  key={req.id}
                  req={req}
                  token={token}
                  selected={req.id === selectedId}
                  isNew={newIds.has(req.id)}
                  onClick={() => setSelectedId(req.id === selectedId ? null : req.id)}
                />
              ))
            )}
          </div>

        </aside>

        {/* Content */}
        <main style={s.content} aria-label="Request detail">
          {requests.length === 0
            ? (liveStatus === 'connecting' ? <ConnectingState /> : <EmptyState inboxUrl={inboxUrl} onCopy={handleCopyTestRequest} />)
            : <DetailPanel req={selectedReq} token={token} />}
        </main>
      </div>
    </>
  )
}

// ---------------------------------------------------------------------------
// Detail styles (d)
// ---------------------------------------------------------------------------

const d = {
  panel: { display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' },
  header: { display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: '12px', padding: '26px 26px 18px', borderBottom: `1px solid ${c.borderSoft}`, flexShrink: 0, flexWrap: 'wrap' },
  headerLeft: { flex: 1, minWidth: 0 },
  eyebrow: { fontFamily: c.mono, fontSize: '11px', color: c.faint, letterSpacing: '0.2em', textTransform: 'uppercase', marginBottom: '12px' },
  headlineRow: { display: 'flex', alignItems: 'baseline', gap: '12px', minWidth: 0 },
  methodLg: { fontFamily: c.mono, fontSize: '22px', flexShrink: 0, letterSpacing: '-0.5px' },
  pathLg: { fontSize: '22px', color: c.fg, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontFamily: c.mono, letterSpacing: '-0.5px' },
  timestamp: { fontFamily: c.mono, fontSize: '11px', color: c.faint, flexShrink: 0 },
  meta: { display: 'flex', flexShrink: 0, borderBottom: `1px solid ${c.borderSoft}`, flexWrap: 'wrap' },
  metaItem: { display: 'flex', flexDirection: 'column', gap: '3px', padding: '10px 18px', borderRight: `1px solid ${c.borderSoft}` },
  metaLabel: { fontFamily: c.mono, fontSize: '10px', color: c.faint, letterSpacing: '0.18em', textTransform: 'uppercase' },
  metaVal: { fontSize: '12px', color: c.dim, fontFamily: c.mono },
  scroll: { flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column' },
  section: { padding: '16px 22px', borderBottom: `1px solid ${c.borderSoft}` },
  sectionTitle: { fontFamily: c.mono, fontSize: '10px', color: c.faint, letterSpacing: '0.2em', textTransform: 'uppercase', marginBottom: '12px' },
  bodyPre: { background: c.lowest, border: `1px solid ${c.border}`, borderRadius: '6px', padding: '14px', fontSize: '12px', color: c.fg, fontFamily: c.mono, overflowX: 'auto', lineHeight: 1.6, whiteSpace: 'pre-wrap', wordBreak: 'break-word', flex: 1 },
  noSel: { display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', gap: '8px', padding: '40px' },
  noSelText: { fontSize: '13px', color: c.dim },
  noSelSub: { fontSize: '12px', color: c.faint, textAlign: 'center', lineHeight: 1.6, maxWidth: '280px' },
  emptyWrap: { display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', padding: '40px' },
  emptyContent: { display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: '18px', maxWidth: '480px', width: '100%' },
  emptyTitle: { fontSize: '17px', fontWeight: 500, color: c.fg },
  emptySub: { fontSize: '13.5px', color: c.dim, lineHeight: 1.6, marginTop: '-10px' },
  curlBlock: { width: '100%', border: `1px solid ${c.border}`, borderRadius: '8px', overflow: 'hidden' },
  curlLabel: { fontFamily: c.mono, fontSize: '10px', color: c.dim, letterSpacing: '0.2em', textTransform: 'uppercase' },
  curlCode: { padding: '14px', fontSize: '12px', color: c.fg, fontFamily: c.mono, lineHeight: 1.7, background: c.lowest, overflowX: 'auto', whiteSpace: 'pre' },
  curlHead:  { padding: '8px 14px', background: c.low, borderBottom: `1px solid ${c.borderSoft}`, display: 'flex', alignItems: 'center', justifyContent: 'space-between' },
  curlCopyBtn: { display: 'flex', alignItems: 'center', gap: '5px', background: 'transparent', border: 'none', padding: '3px 7px', fontFamily: c.mono, fontSize: '10px', color: c.dim, cursor: 'pointer', borderRadius: '4px', letterSpacing: '0.06em', transition: 'background 0.12s, color 0.12s' },
  tips: { display: 'flex', flexDirection: 'column', gap: '7px' },
  tip: { fontSize: '12.5px', color: c.faint },
}

// ---------------------------------------------------------------------------
// Shell styles (s)
// ---------------------------------------------------------------------------

const s = {
  shell: { height: '100vh', display: 'flex', background: c.bg, color: c.fg, fontFamily: c.sans, fontSize: '13px', overflow: 'hidden', position: 'relative' },
  grain: { position: 'fixed', inset: 0, zIndex: 0, pointerEvents: 'none', opacity: 0.02, backgroundImage: `url("${GRAIN}")`, backgroundSize: '200px' },

  // Sidebar — mirrors Dashboard.jsx chrome
  sidebar: { position: 'relative', zIndex: 1, width: '272px', flexShrink: 0, background: c.low, borderRight: `1px solid ${c.borderSoft}`, display: 'flex', flexDirection: 'column', overflow: 'hidden' },
  logo: { padding: '38px 24px 22px', flexShrink: 0 },
  logoText: { fontFamily: c.sans, fontSize: '28px', fontWeight: 500, letterSpacing: '-1px', color: c.fg, textDecoration: 'none' },
  ctxRow: { display: 'flex', alignItems: 'center', gap: '10px', margin: '0 12px 12px', padding: '10px 12px', borderRadius: '8px', flexShrink: 0 },
  ctxIcon: { fontSize: '18px', color: c.faint, flexShrink: 0 },
  ctxName: { flex: 1, fontFamily: c.sans, fontSize: '14px', color: c.dim },

  // Inbox URL card
  urlCard: { display: 'flex', alignItems: 'center', margin: '0 12px 14px', border: `1px solid ${c.border}`, borderRadius: '6px', overflow: 'hidden', background: c.bg, flexShrink: 0 },
  urlText: { flex: 1, fontFamily: c.mono, fontSize: '11px', color: c.dim, padding: '8px 10px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 },
  copyBtn: { display: 'flex', alignItems: 'center', justifyContent: 'center', background: c.ctr, border: 'none', borderLeft: `1px solid ${c.border}`, color: c.dim, padding: '8px 11px', cursor: 'pointer', flexShrink: 0 },

  // Copy-test-request chip — always visible below the URL card so users
  // can grab the curl example even after a request has landed.
  copyTestBtn: { display: 'flex', alignItems: 'center', gap: '8px', margin: '0 12px 12px', padding: '7px 10px', background: 'transparent', border: `1px solid ${c.border}`, borderRadius: '6px', color: c.dim, fontFamily: c.sans, fontSize: '12px', cursor: 'pointer', transition: 'background 0.12s, border-color 0.12s, color 0.12s' },

  // Requests nav
  listHead: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '6px 20px 8px', flexShrink: 0 },
  listHeadLabel: { fontFamily: c.mono, fontSize: '10px', fontWeight: 600, color: c.faint, letterSpacing: '0.2em', textTransform: 'uppercase' },
  listHeadCount: { fontFamily: c.mono, fontSize: '11px', color: c.dim },
  listRows: { flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '2px', padding: '0 8px 8px', minHeight: 0 },
  listEmpty: { display: 'flex', alignItems: 'center', gap: '10px', padding: '16px 12px' },
  listEmptyText: { fontFamily: c.mono, fontSize: '11px', color: c.faint },

  // Bottom-pinned claim CTA
  sidebarBottom: { padding: '14px 12px', borderTop: `1px solid ${c.borderSoft}`, display: 'flex', flexDirection: 'column', gap: '8px', flexShrink: 0 },
  ctaBtn: { display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px', fontFamily: c.sans, fontWeight: 500, fontSize: '13px', color: c.accentInk, borderRadius: '6px', padding: '9px 14px', textDecoration: 'none', background: c.accent },
  ctaCaption: { fontSize: '11px', color: c.faint, lineHeight: 1.5, padding: '0 2px' },

  // Content
  content: { position: 'relative', zIndex: 1, flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column', minWidth: 0 },
  notFound: { height: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: c.bg, fontFamily: c.sans, padding: '32px', color: c.fg, position: 'relative' },
  notFoundInner: { position: 'relative', zIndex: 1, display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: '12px', maxWidth: '400px' },
  notFoundCode: { fontFamily: c.mono, fontSize: '12px', color: c.faint, letterSpacing: '0.2em' },
  notFoundTitle: { fontSize: '22px', fontWeight: 500, color: c.fg },
  notFoundSub: { fontSize: '13.5px', color: c.dim, lineHeight: 1.6 },
  notFoundBtn: { display: 'inline-block', marginTop: '8px', padding: '10px 18px', fontFamily: c.sans, fontWeight: 500, fontSize: '13px', color: c.accentInk, borderRadius: '4px', textDecoration: 'none', background: c.accent },
}

// ---------------------------------------------------------------------------
// ResponseConfigPanel styles (rc)
// ---------------------------------------------------------------------------

const rc = {
  wrap:       { margin: '0 12px 14px', padding: '12px', border: `1px solid ${c.border}`, borderRadius: '6px', background: c.bg, flexShrink: 0, display: 'flex', flexDirection: 'column', gap: '8px', transition: 'padding 0.15s ease' },
  // Header is now a full-width button — the row users tap to expand/collapse.
  headBtn:    { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px', background: 'transparent', border: 'none', padding: '2px 0', cursor: 'pointer', borderRadius: '4px', width: '100%', textAlign: 'left' },
  headLeft:   { display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0 },
  chev:       { fontSize: '16px', color: c.faint, flexShrink: 0, transition: 'color 0.12s' },
  title:      { fontFamily: c.mono, fontSize: '10px', fontWeight: 600, color: c.faint, letterSpacing: '0.2em', textTransform: 'uppercase' },
  pillOn:     { display: 'inline-flex', alignItems: 'center', gap: '6px', fontFamily: c.mono, fontSize: '10px', color: c.accent, letterSpacing: '0.04em' },
  pillOnDot:  { width: '5px', height: '5px', borderRadius: '50%', background: c.accent },
  pillOff:    { fontFamily: c.mono, fontSize: '10px', color: c.faint, letterSpacing: '0.04em' },
  // Compact toggle that replaces the prior default/custom segmented pair.
  switchRow:    { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px', background: 'transparent', border: 'none', padding: '2px 0', cursor: 'pointer', width: '100%', textAlign: 'left' },
  switchRowLabel:{ fontFamily: c.mono, fontSize: '10px', color: c.faint, letterSpacing: '0.2em', textTransform: 'uppercase' },
  switchTrack:  { width: '28px', height: '16px', background: c.lowest, border: `1px solid ${c.border}`, borderRadius: '999px', position: 'relative', transition: 'background 0.15s, border-color 0.15s', flexShrink: 0 },
  switchTrackOn:{ background: c.accentInk, borderColor: c.accent },
  switchThumb:  { position: 'absolute', top: '1px', left: '1px', width: '12px', height: '12px', borderRadius: '50%', background: c.dim, transition: 'transform 0.15s, background 0.15s' },
  switchThumbOn:{ transform: 'translateX(12px)', background: c.accent },
  label:        { fontFamily: c.mono, fontSize: '10px', color: c.faint, letterSpacing: '0.12em', textTransform: 'uppercase', marginTop: '2px' },
  select:     { background: c.lowest, border: `1px solid ${c.border}`, borderRadius: '4px', color: c.fg, fontFamily: c.mono, fontSize: '11px', padding: '6px 8px', outline: 'none' },
  textarea:   { background: c.lowest, border: `1px solid ${c.border}`, borderRadius: '4px', color: c.fg, fontFamily: c.mono, fontSize: '11px', padding: '8px', minHeight: '64px', resize: 'vertical', outline: 'none', lineHeight: 1.5 },
  btnRow:     { display: 'flex', gap: '6px', marginTop: '4px' },
  btnPrimary: { flex: 1, background: c.accent, color: c.accentInk, border: 'none', borderRadius: '4px', padding: '7px 10px', fontFamily: c.sans, fontSize: '12px', fontWeight: 500, cursor: 'pointer' },
  btnGhost:   { background: 'transparent', color: c.dim, border: `1px solid ${c.border}`, borderRadius: '4px', padding: '7px 10px', fontFamily: c.sans, fontSize: '12px', cursor: 'pointer' },
  error:      { fontSize: '11px', color: 'var(--status-red)', fontFamily: c.mono, marginTop: '2px' },
}
