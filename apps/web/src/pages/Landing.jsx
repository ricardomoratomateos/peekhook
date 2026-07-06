import { useState } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { api } from '../lib/api.js'

// Monochrome canvas + single electric-lime accent (aside / radar DNA).
const c = {
  bg: '#0a0a0a',
  lowest: '#000000',
  low: '#111111',
  ctr: '#171717',
  high: '#1f1f1f',
  fg: '#fafafa',
  dim: '#a3a3a3',
  faint: '#838383',
  outline: '#404040',
  border: 'rgba(64,64,64,0.3)',
  borderSoft: 'rgba(64,64,64,0.16)',
  accent: '#c8ff00',
  accentInk: '#0a0a0a',
  sans: "'Geist', ui-sans-serif, system-ui, sans-serif",
  mono: "'Geist Mono', ui-monospace, 'SFMono-Regular', monospace",
}

const methodTone = (m) =>
  ['POST', 'PUT', 'PATCH', 'DELETE'].includes((m || '').toUpperCase())
    ? { color: c.fg, weight: 500 }
    : { color: c.dim, weight: 400 }

const GRAIN = "data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E"

export default function SandboxEntry() {
  const navigate = useNavigate()
  const [status, setStatus] = useState('idle')
  const [errorMsg, setErrorMsg] = useState(null)

  async function handleCreate() {
    setStatus('loading')
    setErrorMsg(null)
    try {
      const inbox = await api.createInbox()
      try {
        localStorage.setItem(`peekhook-${inbox.token}`, JSON.stringify({
          url: inbox.url,
          expiresAt: inbox.expiresAt,
          mcpToken: inbox.mcp_token,
        }))
      } catch (_) {}
      navigate(`/i/${inbox.token}`, {
        state: {
          url: inbox.url,
          expiresAt: inbox.expiresAt,
          mcpToken: inbox.mcp_token,
        }
      })
    } catch (err) {
      setErrorMsg(err.message || 'failed to create inbox. try again.')
      setStatus('error')
    }
  }

  return (
    <>
      <style>{`
        @keyframes sbpulse { 0%,100% { opacity: 1; } 50% { opacity: 0.3; } }
        @keyframes sbrise { from { opacity: 0; transform: translateY(12px); } to { opacity: 1; transform: none; } }
        .sb * { box-sizing: border-box; margin: 0; padding: 0; }
        .sb-rise { opacity: 0; animation: sbrise .65s cubic-bezier(.16,1,.3,1) forwards; }
        .sb-cta { transition: transform .15s cubic-bezier(.16,1,.3,1), background .15s, box-shadow .15s; }
        .sb-cta:hover { transform: translateY(-1px) scale(1.015); background: #d4ff1a; box-shadow: 0 8px 30px rgba(200,255,0,0.18); }
        .sb-cta:active { transform: translateY(0) scale(.99); }
        .sb-cta:disabled { opacity: .6; cursor: not-allowed; transform: none; box-shadow: none; }
        .sb-link { transition: color .15s; }
        .sb-link:hover { color: ${c.fg} !important; }
      `}</style>

      <div className="sb" style={s.page}>
        <div style={s.grain} aria-hidden />

        <nav style={s.nav}>
          <div style={s.navInner}>
            <Link to="/" className="sb-link" style={s.logo}>peekhook</Link>
            <div style={s.navRight}>
              <span style={s.navEyebrow}>inbox</span>
            </div>
          </div>
        </nav>

        <main style={s.hero}>
          <div className="sb-rise" style={{ ...s.eyebrow, animationDelay: '.05s' }}>free webhook inspector</div>

          <h1 className="sb-rise" style={{ ...s.h1, animationDelay: '.12s' }}>
            peek any webhook<br />in real time
          </h1>

          <p className="sb-rise" style={{ ...s.sub, animationDelay: '.3s' }}>
            send any http request to a unique url and inspect method, headers,
            query and body live. no sign-up, no setup.
          </p>

          <div className="sb-rise" style={{ ...s.ctaWrap, animationDelay: '.42s' }}>
            <button
              className="sb-cta"
              onClick={handleCreate}
              disabled={status === 'loading'}
              style={s.cta}
              aria-label="Generate a unique webhook inbox URL"
            >
              {status === 'loading' ? 'generating…' : 'get a webhook url'}
            </button>
            {errorMsg && <div style={s.error} role="alert">{errorMsg}</div>}
            <p style={s.note}>
              temporary — expires in 7 days.
            </p>
          </div>

          <div className="sb-rise" style={{ ...s.preview, animationDelay: '.55s' }} aria-hidden>
            <div style={s.previewHead}>
              <span style={s.previewLabel}>live inspector</span>
              <span style={s.previewLive}><span style={s.previewDot} />live</span>
            </div>
            <div style={s.previewBody}>
              {PREVIEW_ROWS.map((row, i) => {
                const t = methodTone(row.method)
                return (
                  <div key={i} style={s.previewRow}>
                    <span style={{ ...s.previewMethod, color: t.color, fontWeight: t.weight }}>{row.method.toLowerCase()}</span>
                    <span style={s.previewPath}>{row.path}</span>
                    <span style={s.previewTime}>{row.time}</span>
                    <span style={s.previewSize}>{row.size}</span>
                  </div>
                )
              })}
              <div style={s.previewRow}>
                <span style={{ ...s.previewMethod, color: c.accent, animation: 'sbpulse 1.4s ease infinite' }}>···</span>
                <span style={{ ...s.previewPath, color: c.faint }}>waiting for request…</span>
                <span style={s.previewTime}>now</span>
              </div>
            </div>
          </div>
        </main>

        <footer style={s.footer}>
          <span style={s.footerLogo}>peekhook</span>
          <Link to="/" className="sb-link" style={s.footerLink}>back to peekhook</Link>
        </footer>
      </div>
    </>
  )
}

const PREVIEW_ROWS = [
  { method: 'POST',   path: '/webhook/example', time: '2s ago',  size: '1.2 KB' },
  { method: 'POST',   path: '/orders/created', time: '14s ago', size: '3.8 KB' },
  { method: 'GET',    path: '/health',         time: '1m ago',  size: '24 B' },
  { method: 'PUT',    path: '/api/order/42',   time: '3m ago',  size: '512 B' },
  { method: 'DELETE', path: '/session/abc123', time: '7m ago',  size: '0 B' },
]

const s = {
  page: { minHeight: '100vh', background: c.bg, color: c.fg, fontFamily: c.sans, fontSize: '14px', display: 'flex', flexDirection: 'column', position: 'relative' },
  grain: { position: 'fixed', inset: 0, zIndex: 0, pointerEvents: 'none', opacity: 0.022, backgroundImage: `url("${GRAIN}")`, backgroundSize: '200px' },
  nav: { position: 'relative', zIndex: 1, borderBottom: `1px solid ${c.borderSoft}`, flexShrink: 0 },
  navInner: { maxWidth: '1000px', margin: '0 auto', padding: '0 24px', height: '60px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' },
  logo: { fontSize: '14px', fontWeight: 500, color: c.fg, textDecoration: 'none', letterSpacing: '-0.2px' },
  navRight: { display: 'flex', alignItems: 'center', gap: '22px' },
  navEyebrow: { fontFamily: c.mono, fontSize: '11px', color: c.faint, letterSpacing: '0.22em', textTransform: 'uppercase' },
  navLink: { fontSize: '13px', color: c.dim, textDecoration: 'none' },

  hero: { position: 'relative', zIndex: 1, flex: 1, width: '100%', maxWidth: '720px', margin: '0 auto', padding: '120px 24px 80px', display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center' },
  eyebrow: { fontFamily: c.mono, fontSize: '11px', color: c.dim, letterSpacing: '0.24em', textTransform: 'uppercase', marginBottom: '28px', opacity: 0.7 },
  h1: { fontSize: 'clamp(44px, 7vw, 76px)', fontWeight: 500, color: '#ffffff', lineHeight: 0.98, letterSpacing: '-2px', marginBottom: '28px' },
  sub: { fontSize: '17px', color: c.dim, lineHeight: 1.55, maxWidth: '480px', marginBottom: '40px' },
  ctaWrap: { display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '18px' },
  cta: { background: c.accent, color: c.accentInk, border: 'none', borderRadius: '4px', padding: '15px 34px', fontSize: '15px', fontWeight: 500, fontFamily: c.sans, cursor: 'pointer' },
  error: { padding: '8px 14px', background: c.low, border: `1px solid ${c.outline}`, borderRadius: '4px', color: c.dim, fontSize: '13px' },
  note: { fontSize: '13px', color: c.faint, lineHeight: 1.6 },
  noteLink: { color: c.dim, textDecoration: 'none' },

  preview: { width: '100%', maxWidth: '540px', marginTop: '80px', background: c.low, border: `1px solid ${c.border}`, borderRadius: '10px', overflow: 'hidden', textAlign: 'left', boxShadow: '0 24px 60px rgba(0,0,0,0.4)' },
  previewHead: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '11px 16px', borderBottom: `1px solid ${c.borderSoft}`, background: c.lowest },
  previewLabel: { fontFamily: c.mono, fontSize: '10px', color: c.faint, letterSpacing: '0.2em', textTransform: 'uppercase' },
  previewLive: { display: 'flex', alignItems: 'center', gap: '6px', fontFamily: c.mono, fontSize: '10px', color: c.dim, letterSpacing: '0.15em', textTransform: 'uppercase' },
  previewDot: { width: '6px', height: '6px', borderRadius: '50%', background: c.accent, animation: 'sbpulse 2s ease infinite' },
  previewBody: { padding: '6px 0' },
  previewRow: { display: 'flex', alignItems: 'center', gap: '12px', padding: '7px 16px', fontFamily: c.mono, fontSize: '12px' },
  previewMethod: { width: '54px', flexShrink: 0, fontSize: '11px' },
  previewPath: { flex: 1, color: c.dim, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  previewTime: { width: '56px', textAlign: 'right', color: c.faint, fontSize: '11px', flexShrink: 0 },
  previewSize: { width: '52px', textAlign: 'right', color: c.faint, fontSize: '11px', flexShrink: 0 },

  footer: { position: 'relative', zIndex: 1, borderTop: `1px solid ${c.borderSoft}`, padding: '22px 24px', maxWidth: '1000px', margin: '0 auto', width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between' },
  footerLogo: { fontSize: '13px', color: c.faint },
  footerLink: { fontFamily: c.mono, fontSize: '11px', color: c.faint, letterSpacing: '0.15em', textDecoration: 'none' },
}
