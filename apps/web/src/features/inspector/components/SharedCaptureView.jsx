import { useState, useEffect } from 'react'
import { c, GRAIN } from '../lib/tokens.js'
import { s } from '../styles.js'
import { api } from '../../../lib/api.js'

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

export default function SharedCaptureView({ id }) {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    api.getSharedRequest(id)
      .then(d => { if (!cancelled) setData(d) })
      .catch(err => { if (!cancelled) setError(err.message || 'not found') })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [id])

  const bodyText = data ? formatBody(data.body, data.contentType) : null
  const queryRows = data && data.query && typeof data.query === 'object' ? Object.entries(data.query) : []
  const headerRows = data && data.headers ? Object.entries(data.headers) : []

  async function handleCopy() {
    try { await navigator.clipboard.writeText(window.location.href) } catch (_) {}
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  if (loading) {
    return (
      <div style={s.shell}>
        <div style={{ ...s.grain, backgroundImage: `url("${GRAIN}")` }} aria-hidden />
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
        <div style={notFound}>
          <div style={nfCode}>404</div>
          <p style={nfTitle}>capture not found</p>
          <p style={nfSub}>
            {error ? `error: ${error}` : 'this capture has been deleted, expired, or never existed.'}
          </p>
        </div>
      </div>
    )
  }

  return (
    <div style={s.shell}>
      <div style={{ ...s.grain, backgroundImage: `url("${GRAIN}")` }} aria-hidden />
      <div style={topBar}>
        <div style={logo}>peekhook</div>
        <div style={shareBox}>
          <span style={shareUrl}>{window.location.host}{window.location.pathname}</span>
          <button type="button" onClick={handleCopy} className="sb-copy" style={shareCopyBtn}>
            <span className="material-symbols-outlined" style={{ fontSize: '13px' }}>
              {copied ? 'check' : 'content_copy'}
            </span>
            <span>{copied ? 'copied' : 'copy link'}</span>
          </button>
        </div>
      </div>

      <div style={content}>
        <div style={headerCard}>
          <div style={eyebrow}>shared capture · read-only</div>
          <div style={methodRow}>
            <span style={methodChip}>{data.method?.toLowerCase() || '?'}</span>
            <span style={pathText}>{data.path}</span>
          </div>
          <div style={timestampText}>
            {new Date(data.createdAt).toISOString().replace('T', ' ').slice(0, 19)} UTC
          </div>
        </div>

        {queryRows.length > 0 && (
          <section style={section}>
            <div style={sectionTitle}>query params</div>
            <table style={table}>
              <tbody>
                {queryRows.map(([k, v]) => (
                  <tr key={k} style={tr}>
                    <td style={tdKey}>{k}</td>
                    <td style={tdVal}>{Array.isArray(v) ? v.join(', ') : String(v)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        )}

        <section style={section}>
          <div style={sectionTitle}>headers</div>
          <table style={table}>
            <tbody>
              {headerRows.map(([k, v]) => (
                <tr key={k} style={tr}>
                  <td style={tdKey}>{k}</td>
                  <td style={tdVal}>{Array.isArray(v) ? v.join(', ') : String(v)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        <section style={section}>
          <div style={sectionTitle}>body</div>
          {bodyText
            ? <pre style={pre}>{bodyText}</pre>
            : <span style={emptyBody}>empty body</span>}
        </section>
      </div>
    </div>
  )
}

const center = {
  position: 'relative', zIndex: 1,
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  height: '100vh',
}
const centerMsg = {
  fontFamily: c.mono, fontSize: '12px', color: c.faint,
  letterSpacing: '0.1em', textTransform: 'uppercase',
}

const notFound = {
  position: 'relative', zIndex: 1,
  display: 'flex', flexDirection: 'column', alignItems: 'flex-start',
  gap: '8px', maxWidth: '400px', padding: '32px',
  margin: '0 auto', marginTop: '20vh',
}
const nfCode = { fontFamily: c.mono, fontSize: '12px', color: c.faint, letterSpacing: '0.2em' }
const nfTitle = { fontSize: '22px', fontWeight: 500, color: c.fg }
const nfSub = { fontSize: '13px', color: c.dim, lineHeight: 1.6 }

const topBar = {
  position: 'relative', zIndex: 1,
  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
  padding: '20px 32px',
  borderBottom: `1px solid ${c.borderSoft}`,
}
const logo = {
  fontFamily: c.sans, fontSize: '22px', fontWeight: 500,
  letterSpacing: '-0.7px', color: c.fg,
  textDecoration: 'none',
}
const shareBox = {
  display: 'flex', alignItems: 'center',
  border: `1px solid ${c.border}`, borderRadius: '4px',
  overflow: 'hidden', background: c.bg,
}
const shareUrl = {
  fontFamily: c.mono, fontSize: '10px', color: c.dim,
  padding: '6px 10px', maxWidth: '300px',
  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
}
const shareCopyBtn = {
  display: 'flex', alignItems: 'center', gap: '4px',
  background: c.ctr, border: 'none', borderLeft: `1px solid ${c.border}`,
  color: c.dim, padding: '6px 10px', cursor: 'pointer',
  fontFamily: c.sans, fontSize: '11px',
}

const content = {
  position: 'relative', zIndex: 1,
  maxWidth: '780px', margin: '0 auto', padding: '24px 32px 80px',
}

const headerCard = {
  border: `1px solid ${c.border}`,
  borderRadius: '6px',
  background: c.low,
  padding: '16px 18px',
  marginBottom: '16px',
}
const eyebrow = {
  fontFamily: c.mono, fontSize: '10px', color: c.faint,
  letterSpacing: '0.2em', textTransform: 'uppercase',
  marginBottom: '8px',
}
const methodRow = {
  display: 'flex', alignItems: 'baseline', gap: '12px', flexWrap: 'wrap',
  marginBottom: '6px',
}
const methodChip = {
  display: 'inline-block', padding: '2px 6px', borderRadius: '4px',
  border: `1px solid ${c.border}`, color: c.fg, fontWeight: 500,
  fontSize: '10px', letterSpacing: '0.04em', flexShrink: 0,
  fontFamily: c.mono,
}
const pathText = {
  fontSize: '17px', color: c.fg, fontWeight: 500,
  fontFamily: c.mono, letterSpacing: '-0.3px',
  wordBreak: 'break-all', minWidth: 0,
}
const timestampText = {
  fontFamily: c.mono, fontSize: '10px', color: c.faint,
}

const section = {
  padding: '14px 18px', borderBottom: `1px solid ${c.borderSoft}`,
  background: c.bg, borderRadius: '6px', marginBottom: '6px',
}
const sectionTitle = {
  fontFamily: c.mono, fontSize: '10px', color: c.faint,
  letterSpacing: '0.2em', textTransform: 'uppercase', marginBottom: '10px',
}
const table = { width: '100%', borderCollapse: 'collapse', fontSize: '12px' }
const tr = { borderBottom: `1px solid ${c.borderSoft}` }
const tdKey = {
  fontFamily: c.mono, color: c.faint, width: '38%', verticalAlign: 'top',
  padding: '5px 12px 5px 0', whiteSpace: 'nowrap',
}
const tdVal = { fontFamily: c.mono, color: c.dim, wordBreak: 'break-all', padding: '5px 0' }
const pre = {
  background: c.lowest, border: `1px solid ${c.border}`,
  borderRadius: '4px', padding: '12px',
  fontSize: '12px', color: c.fg, fontFamily: c.mono,
  overflowX: 'auto', lineHeight: 1.6, whiteSpace: 'pre-wrap',
  wordBreak: 'break-word', margin: 0,
}
const emptyBody = { fontSize: '12px', color: c.faint }
