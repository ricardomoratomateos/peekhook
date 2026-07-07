import { useEffect, useState } from 'react'
import { c } from '../lib/tokens.js'
import { methodTone, formatBody, formatSize, prettyPath, timeAgo } from '../lib/format.js'
import KVTable from './KVTable.jsx'
import Meta from './Meta.jsx'
import { d, fr } from '../styles.js'
import { api } from '../../../lib/api.js'

/**
 * Walk a parsed JSON value the same way the backend's PayloadSignature
 * does — dot-separated paths, arrays emitted as a single leaf with no
 * element recursion, empty objects emitted as a single `object` leaf.
 * Returns the set of all paths present in the body.
 */
function collectBodyPaths(value, prefix, out) {
  if (value === null) {
    out.add(prefix)
    return
  }
  if (Array.isArray(value)) {
    out.add(prefix)
    return
  }
  const t = typeof value
  if (t === 'string' || t === 'number' || t === 'boolean') {
    out.add(prefix)
    return
  }
  if (t === 'object') {
    const keys = Object.keys(value)
    if (keys.length === 0) {
      out.add(prefix)
      return
    }
    for (const key of keys) {
      const next = prefix ? `${prefix}.${key}` : key
      collectBodyPaths(value[key], next, out)
    }
  }
}

function pathsInBody(body, contentType) {
  if (body == null || body === '') return new Set()
  let parsed
  if (typeof body === 'object') {
    parsed = body
  } else if (typeof body === 'string') {
    const ct = (contentType || '').toLowerCase()
    if (!ct.includes('json')) return new Set()
    try { parsed = JSON.parse(body) } catch (_) { return new Set() }
  } else {
    return new Set()
  }
  const out = new Set()
  collectBodyPaths(parsed, '', out)
  return out
}

/**
 * Compute the set of paths in the request body that were NOT yet part
 * of the inbox's schema at the time the request was captured. A field
 * counts as "known at capture" if it has a schema-history entry with
 * firstSeenAt <= request.createdAt; otherwise it's a new field added
 * by a later request — surfaced as the `+N new since capture` chip.
 */
function computeDrift(body, contentType, fields, createdAtMs) {
  const bodyPaths = pathsInBody(body, contentType)
  if (bodyPaths.size === 0) return { newCount: 0, newPaths: [] }
  const knownAtCapture = new Set(
    (fields || [])
      .filter(f => new Date(f.firstSeenAt).getTime() <= createdAtMs)
      .map(f => f.path),
  )
  const newPaths = []
  for (const p of bodyPaths) {
    if (!knownAtCapture.has(p)) newPaths.push(p)
  }
  return { newCount: newPaths.length, newPaths }
}

export default function DetailPanel({ req, token }) {
  const [schemaFields, setSchemaFields] = useState([])
  const [replayState, setReplayState] = useState('idle')
  const [replayed, setReplayed] = useState(null)
  const [replayError, setReplayError] = useState(null)
  const [shareState, setShareState] = useState('idle')

  useEffect(() => {
    if (!token) return
    let cancelled = false
    api.getSchemaHistory(token)
      .then(d => { if (!cancelled) setSchemaFields(d?.fields || []) })
      .catch(() => { if (!cancelled) setSchemaFields([]) })
    return () => { cancelled = true }
  }, [token])

  useEffect(() => {
    setReplayState('idle')
    setReplayed(null)
    setReplayError(null)
    setShareState('idle')
  }, [req?.id])

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
  const drift = computeDrift(req.body, req.contentType, schemaFields, new Date(req.createdAt).getTime())

  async function handleReplay() {
    if (!req) return
    setReplayState('loading')
    setReplayed(null)
    setReplayError(null)
    try {
      const res = await api.replayEvent(token, req.id)
      setReplayState('done')
      setReplayed(res?.replayed || null)
      setTimeout(() => {
        setReplayState(s => s === 'done' ? 'idle' : s)
        setReplayed(null)
      }, 3000)
    } catch (err) {
      setReplayState('error')
      if (err.status === 429) {
        setReplayError('rate-limited, retry in 60s')
      } else {
        setReplayError(err.message || 'replay failed')
      }
      setTimeout(() => {
        setReplayState(s => s === 'error' ? 'idle' : s)
        setReplayError(null)
      }, 3000)
    }
  }

  async function handleShare() {
    if (!req || shareState === 'loading') return
    setShareState('loading')
    try {
      const res = await api.shareRequest(token, req.id)
      const url = res && typeof res.shareUrl === 'string' ? res.shareUrl : null
      if (url) {
        try { await navigator.clipboard.writeText(url) } catch (_) {}
      }
      setShareState('done')
    } catch (_) {
      setShareState('error')
    }
    setTimeout(() => {
      setShareState(s => (s === 'done' || s === 'error') ? 'idle' : s)
    }, 2000)
  }

  return (
    <div style={d.panel}>
      <div style={d.header}>
        <div style={d.headerLeft}>
          <div style={d.eyebrow}>event · {timeAgo(req.createdAt)}</div>
          <div style={d.headlineRow}>
            <span style={{ ...d.methodLg, color: t.color, fontWeight: t.weight }}>{(req.method || '?').toLowerCase()}</span>
            <span style={d.pathLg}>{prettyPath(req.path, token)}</span>
            {drift.newCount > 0 && (
              <span
                style={driftChip}
                title={drift.newPaths.join('\n')}
                aria-label={`${drift.newCount} new field${drift.newCount === 1 ? '' : 's'} since this request was captured`}
              >
                +{drift.newCount} new since capture
              </span>
            )}
          </div>
        </div>
        <div style={headerRight}>
          <button
            type="button"
            onClick={handleReplay}
            disabled={replayState === 'loading'}
            className="sb-replay"
            style={{ ...replayBtn, ...(replayState === 'loading' ? replayBtnDisabled : {}) }}
            aria-label="Replay this request"
          >
            <span className="material-symbols-outlined" style={{ fontSize: '13px' }}>
              {replayState === 'loading' ? 'progress_activity' : 'replay'}
            </span>
            <span>{replayState === 'loading' ? 'replaying…' : 'replay'}</span>
          </button>
          <button
            type="button"
            onClick={handleShare}
            disabled={shareState === 'loading'}
            className="sb-share"
            style={{ ...shareBtn, ...(shareState === 'loading' ? replayBtnDisabled : {}) }}
            aria-label="copy share link"
          >
            <span className="material-symbols-outlined" style={{ fontSize: '13px' }}>
              {shareState === 'loading' ? 'progress_activity'
                : shareState === 'done' ? 'check'
                : shareState === 'error' ? 'error'
                : 'link'}
            </span>
            <span>{
              shareState === 'loading' ? 'sharing…'
              : shareState === 'done' ? 'link copied'
              : shareState === 'error' ? 'share failed'
              : 'share'
            }</span>
          </button>
          <span style={d.timestamp}>{new Date(req.createdAt).toISOString().replace('T', ' ').slice(0, 19)}</span>
        </div>
      </div>

      {(replayed || replayError) && (
        <div style={replayBannerRow}>
          {replayed && (
            <span style={replayBadge}>
              replayed · {replayed.status} {replayed.contentType || ''}
            </span>
          )}
          {replayError && (
            <span style={replayErrorBadge}>{replayError}</span>
          )}
          {replayed?.body && (
            <details style={replayDetails}>
              <summary style={replayDetailsSummary}>response body</summary>
              <pre style={replayDetailsBody}>{replayed.body}</pre>
            </details>
          )}
        </div>
      )}

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
          {bodyText
            ? <pre style={d.bodyPre}>{bodyText}</pre>
            : <span style={{ fontSize: '12px', color: c.faint }}>empty body</span>}
        </section>
        {req.upstreamResponse && (
          <section style={d.section}>
            <ForwardedSection upstream={req.upstreamResponse} />
          </section>
        )}
      </div>
    </div>
  )
}

function ForwardedSection({ upstream }) {
  const err = upstream && upstream.error
  const statusChip = err
    ? <span style={fr.statusErr}>{upstream.error}</span>
    : <span style={fr.statusOk}>{upstream.status}</span>

  return (
    <div style={fr.section}>
      <div style={d.sectionTitle}>forwarded response</div>
      <div style={fr.statusRow}>
        {statusChip}
        {upstream.contentType && (
          <span style={{ ...fr.pill }}>{upstream.contentType}</span>
        )}
        {typeof upstream.durationMs === 'number' && (
          <span style={{ ...fr.pill }}>{upstream.durationMs}ms</span>
        )}
      </div>
      {err ? (
        <pre style={fr.pre}>{upstream.message || upstream.error}</pre>
      ) : upstream.body ? (
        <pre style={fr.pre}>{formatBody(upstream.body, upstream.contentType) || upstream.body}</pre>
      ) : (
        <span style={{ fontSize: '12px', color: c.faint, fontFamily: c.mono }}>empty body</span>
      )}
      {upstream.headers && Object.keys(upstream.headers).length > 0 && (
        <KVTable rows={Object.entries(upstream.headers)} />
      )}
    </div>
  )
}

const headerRight = {
  display: 'flex', alignItems: 'center', gap: '14px', flexShrink: 0,
}

const replayBtn = {
  display: 'inline-flex', alignItems: 'center', gap: '5px',
  background: 'transparent',
  border: `1px solid ${c.border}`,
  borderRadius: '5px',
  padding: '5px 9px',
  fontFamily: c.mono,
  fontSize: '11px',
  color: c.dim,
  cursor: 'pointer',
  letterSpacing: '0.04em',
  transition: 'background 0.12s, border-color 0.12s, color 0.12s',
}

const shareBtn = replayBtn

const replayBtnDisabled = {
  opacity: 0.55,
  cursor: 'not-allowed',
}

const replayBannerRow = {
  display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '10px',
  padding: '10px 26px',
  borderBottom: `1px solid ${c.borderSoft}`,
  background: c.low,
  flexShrink: 0,
}

const replayBadge = {
  display: 'inline-flex', alignItems: 'center',
  fontFamily: c.mono, fontSize: '11px',
  color: c.accent,
  padding: '3px 8px',
  borderRadius: '4px',
  border: `1px solid ${c.border}`,
  background: c.bg,
}

const replayErrorBadge = {
  display: 'inline-flex', alignItems: 'center',
  fontFamily: c.mono, fontSize: '11px',
  color: 'var(--status-red)',
  padding: '3px 8px',
  borderRadius: '4px',
  border: `1px solid ${c.border}`,
  background: c.bg,
}

const replayDetails = {
  fontFamily: c.mono, fontSize: '11px', color: c.dim,
  marginLeft: 'auto',
}

const replayDetailsSummary = {
  cursor: 'pointer', color: c.faint, letterSpacing: '0.04em',
}

const replayDetailsBody = {
  marginTop: '6px',
  padding: '8px 10px',
  background: c.lowest,
  border: `1px solid ${c.border}`,
  borderRadius: '4px',
  fontFamily: c.mono,
  fontSize: '11px',
  color: c.fg,
  maxHeight: '160px',
  overflow: 'auto',
  whiteSpace: 'pre-wrap',
  wordBreak: 'break-word',
}

const driftChip = {
  display: 'inline-flex', alignItems: 'center',
  fontFamily: c.mono, fontSize: '10px',
  color: c.accent,
  padding: '2px 7px',
  borderRadius: '999px',
  border: `1px solid ${c.border}`,
  background: c.bg,
  letterSpacing: '0.04em',
  flexShrink: 0,
  cursor: 'help',
}