import { useState, useEffect } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { c, GRAIN } from '../lib/tokens.js'
import { s, d, fr } from '../styles.js'
import { api } from '../../../lib/api.js'
import { methodTone, formatBody, formatSize, prettyPath, timeAgo } from '../lib/format.js'
import KVTable from './KVTable.jsx'
import Meta from './Meta.jsx'

export default function SharedCaptureView({ id }) {
  const [params] = useSearchParams()
  const token = params.get('token') || ''
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    if (!token) {
      setError('token required')
      setLoading(false)
      return () => { cancelled = true }
    }
    api.getSharedRequest(id, token)
      .then(d => { if (!cancelled) setData(d) })
      .catch(err => { if (!cancelled) setError(err.message || 'not found') })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [id, token])

  async function handleCopy() {
    try { await navigator.clipboard.writeText(window.location.href) } catch (_) {}
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const logo = (
    <Link to="/" className="sb-link" style={s.railLogo} aria-label="peekhook home">p</Link>
  )

  if (loading) {
    return (
      <div style={s.shell}>
        <div style={{ ...s.grain, backgroundImage: `url("${GRAIN}")` }} aria-hidden />
        <aside style={s.rail} aria-label="peekhook">{logo}</aside>
        <div style={center}>
          <p style={centerMsg}>loading capture {id}…</p>
        </div>
      </div>
    )
  }

  if (error || !data) {
    return (
      <div style={s.shell}>
        <div style={{ ...s.grain, backgroundImage: `url("${GRAIN}")` }} aria-hidden />
        <aside style={s.rail} aria-label="peekhook">{logo}</aside>
        <div style={notFound}>
          <div style={notFoundCode}>404</div>
          <p style={notFoundTitle}>capture not found</p>
          <p style={notFoundSub}>
            {error ? `error: ${error}` : 'this capture has been deleted, expired, or never existed.'}
          </p>
          <Link to="/" style={notFoundBtn}>get a new inbox</Link>
        </div>
      </div>
    )
  }

  const t = methodTone(data.method)
  const bodyText = formatBody(data.body, data.contentType)
  const queryRows = data.query && typeof data.query === 'object' ? Object.entries(data.query) : []
  const headerRows = data.headers ? Object.entries(data.headers) : []
  const timestamp = new Date(data.createdAt).toISOString().replace('T', ' ').slice(0, 19)
  const prettyP = prettyPath(data.path, token) || '/'

  return (
    <div style={s.shell}>
      <div style={{ ...s.grain, backgroundImage: `url("${GRAIN}")` }} aria-hidden />

      <aside style={s.rail} aria-label="peekhook">{logo}</aside>

      <div style={s.page}>
        <header style={s.pageHeader}>
          <div style={d.eyebrow}>read-only · shared capture · {timeAgo(data.createdAt)}</div>
          <div style={s.pageHeaderRow}>
            <div style={d.headlineRow}>
              <span style={{ ...d.methodLg, color: t.color, fontWeight: t.weight }}>
                {(data.method || '?').toLowerCase()}
              </span>
              <span style={d.pathLg} title={data.path}>{prettyP}</span>
            </div>
            <div style={s.pageHeaderRight}>
              <button
                type="button"
                onClick={handleCopy}
                className="sb-share"
                style={shareBtn}
                aria-label={copied ? 'Link copied' : 'Copy share link'}
              >
                <span className="material-symbols-outlined" style={{ fontSize: '13px' }}>
                  {copied ? 'check' : 'link'}
                </span>
                <span>{copied ? 'link copied' : 'copy link'}</span>
              </button>
              <span style={d.timestamp}>{timestamp}</span>
            </div>
          </div>
        </header>

        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0, overflow: 'hidden' }}>
          <div style={d.meta}>
            {data.ip && <Meta label="ip" value={data.ip} />}
            {data.contentType && <Meta label="content-type" value={data.contentType} />}
            {data.size != null && <Meta label="size" value={formatSize(data.size)} />}
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
            {data.upstreamResponse && (
              <section style={d.section}>
                <div style={d.sectionTitle}>forwarded response</div>
                <ForwardedSection upstream={data.upstreamResponse} />
              </section>
            )}
          </div>
        </div>
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
      <div style={fr.statusRow}>
        {statusChip}
        {upstream.contentType && <span style={fr.pill}>{upstream.contentType}</span>}
        {typeof upstream.durationMs === 'number' && <span style={fr.pill}>{upstream.durationMs}ms</span>}
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

const shareBtn = {
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
}

const center = {
  position: 'relative', zIndex: 1,
  flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center',
}

const centerMsg = {
  fontFamily: c.mono, fontSize: '12px', color: c.faint,
  letterSpacing: '0.1em', textTransform: 'uppercase',
}

const notFound = {
  position: 'relative', zIndex: 1,
  flex: 1, display: 'flex', flexDirection: 'column',
  alignItems: 'flex-start', justifyContent: 'center',
  gap: '10px', padding: '40px', maxWidth: '480px',
}

const notFoundCode = { fontFamily: c.mono, fontSize: '12px', color: c.faint, letterSpacing: '0.2em' }
const notFoundTitle = { fontSize: '22px', fontWeight: 500, color: c.fg }
const notFoundSub = { fontSize: '13.5px', color: c.dim, lineHeight: 1.6 }
const notFoundBtn = {
  marginTop: '10px', padding: '10px 18px',
  fontFamily: c.sans, fontWeight: 500, fontSize: '13px',
  color: c.accentInk, borderRadius: '4px',
  textDecoration: 'none', background: c.accent,
}
