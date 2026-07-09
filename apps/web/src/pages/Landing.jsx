import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../lib/api.js'

// Alternative Product Hunt landing — agent-first positioning.
// Self-contained: inline styles + one <style> block for keyframes,
// hover states, and responsive breakpoints. No external UI libs.

const MONO = '"Geist Mono", "SFMono-Regular", ui-monospace, Menlo, monospace'
const SANS = '"Geist", -apple-system, "Segoe UI", Helvetica, Arial, sans-serif'

const C = {
  bg: '#0a0a0a',
  surface: '#111111',
  surface2: '#171717',
  surface3: '#1f1f1f',
  text: '#fafafa',
  dim: '#a3a3a3',
  faint: '#838383',
  border: 'rgba(64,64,64,.16)',
  borderStrong: 'rgba(64,64,64,.3)',
  accent: '#c8ff00',
  accentInk: '#0a0a0a',
  accent10: 'rgba(200,255,0,.10)',
  red: '#f87171',
}

const GITHUB = 'https://github.com/ricardomoratomateos/peekhook'
const SITE = (import.meta.env.VITE_WEB_URL || 'https://peekhook.dev').replace(/\/$/, '')

// ---------------------------------------------------------------- css

const css = `
  .phf-root { background: ${C.bg}; }
  .phf-root ::selection { background: ${C.accent}; color: ${C.accentInk}; }

  .phf-cta {
    transition: transform .13s ease, background .13s ease, border-color .13s ease;
  }
  .phf-cta-primary:hover { background: #d4ff33; transform: translateY(-1px); }
  .phf-cta-ghost:hover { border-color: rgba(200,255,0,.5); color: ${C.text}; }
  .phf-link { color: ${C.faint}; text-decoration: none; transition: color .13s ease; }
  .phf-link:hover { color: ${C.accent}; }
  .phf-minicta { transition: color .13s ease; }
  .phf-minicta:hover { color: #d4ff33; }

  .phf-hero-grid { display: grid; grid-template-columns: 1fr 1fr; }
  .phf-act { display: grid; grid-template-columns: 1fr 1fr; gap: 56px; align-items: center; }
  .phf-act-flip .phf-act-copy { order: 2; }
  .phf-caps { display: grid; grid-template-columns: repeat(5, 1fr); gap: 1px; }
  .phf-faq { display: grid; grid-template-columns: 1fr 1fr; gap: 1px; }

  @media (max-width: 900px) {
    .phf-hero-grid { grid-template-columns: 1fr; }
    .phf-act, .phf-act-flip { grid-template-columns: 1fr; gap: 28px; }
    .phf-act-flip .phf-act-copy { order: 0; }
    .phf-caps { grid-template-columns: repeat(2, 1fr); }
    .phf-faq { grid-template-columns: 1fr; }
  }
  @media (max-width: 520px) {
    .phf-caps { grid-template-columns: 1fr; }
  }

  /* ------- hero animation, one shared 16s timeline ------- */
  .phv { animation-duration: 16s; animation-iteration-count: infinite; animation-timing-function: ease; opacity: 0; }

  @keyframes phvRow {
    0%, 3%   { opacity: 0; transform: translateX(-10px); }
    6%, 90%  { opacity: 1; transform: none; }
    96%,100% { opacity: 0; transform: none; }
  }
  @keyframes phvAsk {
    0%, 12%  { opacity: 0; transform: translateY(6px); }
    15%, 90% { opacity: 1; transform: none; }
    96%,100% { opacity: 0; }
  }
  @keyframes phvThink {
    0%, 17%   { opacity: 0; }
    20%, 24%  { opacity: 1; }
    27%, 100% { opacity: 0; }
  }
  @keyframes phvTool1 {
    0%, 24%  { opacity: 0; transform: translateY(5px); background: rgba(200,255,0,.16); }
    27%      { opacity: 1; transform: none; background: rgba(200,255,0,.16); }
    33%, 90% { opacity: 1; transform: none; background: rgba(200,255,0,.05); }
    96%,100% { opacity: 0; }
  }
  @keyframes phvTool2 {
    0%, 34%  { opacity: 0; transform: translateY(5px); background: rgba(200,255,0,.16); }
    37%      { opacity: 1; transform: none; background: rgba(200,255,0,.16); }
    43%, 90% { opacity: 1; transform: none; background: rgba(200,255,0,.05); }
    96%,100% { opacity: 0; }
  }
  @keyframes phvAns1 {
    0%, 47%  { opacity: 0; transform: translateY(4px); }
    50%, 90% { opacity: 1; transform: none; }
    96%,100% { opacity: 0; }
  }
  @keyframes phvAns2 {
    0%, 52%  { opacity: 0; transform: translateY(4px); }
    55%, 90% { opacity: 1; transform: none; }
    96%,100% { opacity: 0; }
  }
  @keyframes phvAns3 {
    0%, 60%  { opacity: 0; transform: translateY(4px); }
    63%, 90% { opacity: 1; transform: none; }
    96%,100% { opacity: 0; }
  }
  @keyframes phvPulse {
    0%, 100% { box-shadow: 0 0 0 0 rgba(200,255,0,.45); }
    50%      { box-shadow: 0 0 0 5px rgba(200,255,0,0); }
  }
  @keyframes phvBlink {
    0%, 49%   { opacity: 1; }
    50%, 100% { opacity: 0; }
  }

  .phv-row   { animation-name: phvRow; }
  .phv-ask   { animation-name: phvAsk; }
  .phv-think { animation-name: phvThink; }
  .phv-tool1 { animation-name: phvTool1; }
  .phv-tool2 { animation-name: phvTool2; }
  .phv-ans1  { animation-name: phvAns1; }
  .phv-ans2  { animation-name: phvAns2; }
  .phv-ans3  { animation-name: phvAns3; }

  .phv-pulse { animation: phvPulse 2s ease infinite; }
  .phv-caret { animation: phvBlink 1s steps(1) infinite; opacity: 1; }

  @media (prefers-reduced-motion: reduce) {
    .phv { animation: none !important; opacity: 1 !important; transform: none !important; }
    .phv-pulse, .phv-caret { animation: none !important; }
  }
`

// ---------------------------------------------------------------- styles

const s = {
  page: {
    minHeight: '100vh',
    background: C.bg,
    color: C.text,
    fontFamily: SANS,
    fontSize: 14,
    lineHeight: 1.5,
  },
  shell: { maxWidth: 1080, margin: '0 auto', padding: '0 24px' },
  toast: {
    position: 'fixed',
    bottom: 24,
    left: '50%',
    transform: 'translateX(-50%)',
    zIndex: 50,
    fontFamily: MONO,
    fontSize: 12.5,
    color: C.text,
    background: C.surface2,
    border: `1px solid ${C.red}`,
    borderRadius: 8,
    padding: '10px 16px',
    cursor: 'pointer',
    boxShadow: '0 8px 30px rgba(0,0,0,.5)',
  },

  // nav
  nav: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '20px 0',
    borderBottom: `1px solid ${C.border}`,
  },
  wordmark: { fontFamily: MONO, fontSize: 15, fontWeight: 500, color: C.text, textDecoration: 'none' },
  wordmarkDot: { color: C.accent },
  navLinks: { display: 'flex', alignItems: 'center', gap: 24 },
  navLink: { fontFamily: MONO, fontSize: 12 },
  navCta: {
    fontFamily: MONO,
    fontSize: 12,
    background: C.accent,
    color: C.accentInk,
    border: 'none',
    borderRadius: 6,
    padding: '8px 14px',
    cursor: 'pointer',
    fontWeight: 500,
  },

  // hero
  hero: { padding: '88px 0 56px', textAlign: 'center' },
  eyebrow: {
    fontFamily: MONO,
    fontSize: 11,
    letterSpacing: '0.22em',
    textTransform: 'uppercase',
    color: C.faint,
  },
  eyebrowMark: { color: C.accent },
  h1: {
    fontSize: 'clamp(44px, 7vw, 76px)',
    lineHeight: 0.98,
    letterSpacing: '-2px',
    fontWeight: 600,
    margin: '20px auto 0',
    maxWidth: 720,
  },
  heroSub: {
    color: C.dim,
    fontSize: 16,
    maxWidth: 620,
    margin: '24px auto 0',
  },
  heroCtas: {
    display: 'flex',
    gap: 12,
    justifyContent: 'center',
    alignItems: 'center',
    flexWrap: 'wrap',
    marginTop: 32,
  },
  ctaPrimary: {
    fontFamily: MONO,
    fontSize: 13,
    fontWeight: 500,
    background: C.accent,
    color: C.accentInk,
    border: 'none',
    borderRadius: 6,
    padding: '13px 22px',
    cursor: 'pointer',
  },
  ctaGhost: {
    fontFamily: MONO,
    fontSize: 13,
    background: 'transparent',
    color: C.dim,
    border: `1px solid ${C.borderStrong}`,
    borderRadius: 6,
    padding: '12px 20px',
    cursor: 'pointer',
    textDecoration: 'none',
    display: 'inline-block',
  },
  heroHint: { fontFamily: MONO, fontSize: 11.5, color: C.faint, marginTop: 18 },
  heroHintCmd: { color: C.dim },

  // hero visual (two-pane window)
  heroVisual: {
    maxWidth: 920,
    margin: '56px auto 0',
    border: `1px solid ${C.borderStrong}`,
    borderRadius: 8,
    background: C.surface,
    overflow: 'hidden',
    textAlign: 'left',
    boxShadow: '0 40px 120px -40px rgba(200,255,0,.07)',
  },
  paneHead: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '10px 14px',
    borderBottom: `1px solid ${C.border}`,
    fontFamily: MONO,
    fontSize: 10.5,
    letterSpacing: '0.18em',
    textTransform: 'uppercase',
    color: C.faint,
  },
  liveChip: { display: 'inline-flex', alignItems: 'center', gap: 6, color: C.dim, letterSpacing: '0.1em' },
  liveDot: { width: 6, height: 6, borderRadius: 999, background: C.accent },
  paneLeft: { borderRight: `1px solid ${C.border}` },
  paneBody: { padding: '12px 14px', fontFamily: MONO, fontSize: 12.5, minHeight: 236 },
  reqRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    padding: '9px 10px',
    borderRadius: 6,
    color: C.dim,
  },
  reqRowNew: { background: C.accent10, color: C.text },
  method: { color: C.text, fontWeight: 500, width: 38 },
  path: { flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  st200: { color: C.faint },
  st400: { color: C.red, fontWeight: 500 },
  rowTime: { color: C.faint, fontSize: 11 },
  rowDot: { width: 6, height: 6, borderRadius: 999, background: C.accent, flexShrink: 0 },

  askLine: { color: C.text, marginBottom: 12 },
  askPrompt: { color: C.accent },
  thinkLine: { color: C.faint, marginBottom: 12 },
  toolChip: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 7,
    fontFamily: MONO,
    fontSize: 11.5,
    color: C.accent,
    border: `1px solid rgba(200,255,0,.35)`,
    borderRadius: 999,
    padding: '4px 11px',
    marginRight: 8,
    marginBottom: 12,
  },
  ansLine: { color: C.dim, marginBottom: 8 },
  diffBlock: {
    border: `1px solid ${C.border}`,
    borderRadius: 6,
    background: C.bg,
    padding: '8px 12px',
    margin: '2px 0 10px',
    fontSize: 12,
  },
  diffDel: { color: C.red, display: 'block' },
  diffAdd: { color: C.accent, display: 'block' },
  caret: { display: 'inline-block', width: 7, height: 13, background: C.accent, verticalAlign: '-2px', marginLeft: 2 },

  // acts
  act: { padding: '96px 0', borderTop: `1px solid ${C.border}` },
  actEyebrow: {
    fontFamily: MONO,
    fontSize: 11,
    letterSpacing: '0.22em',
    textTransform: 'uppercase',
    color: C.faint,
    marginBottom: 16,
  },
  actNum: { color: C.accent },
  h2: {
    fontSize: 'clamp(28px, 4vw, 40px)',
    lineHeight: 1.05,
    letterSpacing: '-1px',
    fontWeight: 600,
    margin: 0,
  },
  actBody: { color: C.dim, marginTop: 18, fontSize: 14.5 },
  actStrong: { color: C.text },
  inlineMono: { fontFamily: MONO, fontSize: '0.92em', color: C.text },
  toolList: { display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 20 },
  toolPill: {
    fontFamily: MONO,
    fontSize: 11.5,
    color: C.dim,
    border: `1px solid ${C.borderStrong}`,
    borderRadius: 999,
    padding: '4px 11px',
    background: C.surface,
  },
  miniCta: {
    display: 'inline-block',
    fontFamily: MONO,
    fontSize: 12.5,
    color: C.accent,
    background: 'none',
    border: 'none',
    padding: 0,
    marginTop: 24,
    cursor: 'pointer',
    textDecoration: 'none',
  },

  term: {
    border: `1px solid ${C.borderStrong}`,
    borderRadius: 8,
    background: C.surface,
    overflow: 'hidden',
    fontFamily: MONO,
    fontSize: 12.5,
  },
  termHead: {
    padding: '9px 14px',
    borderBottom: `1px solid ${C.border}`,
    fontSize: 10.5,
    letterSpacing: '0.18em',
    textTransform: 'uppercase',
    color: C.faint,
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  termBody: { padding: '14px 16px', color: C.dim, lineHeight: 1.75 },
  prompt: { color: C.accent },
  tOk: { color: C.accent },
  tDim: { color: C.faint },
  tStrong: { color: C.text },
  tRed: { color: C.red },

  // act 2 mock inspector
  searchBar: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    padding: '8px 12px',
    borderBottom: `1px solid ${C.border}`,
    color: C.faint,
    fontSize: 12,
  },
  fieldPill: {
    marginLeft: 'auto',
    border: `1px solid ${C.borderStrong}`,
    borderRadius: 999,
    padding: '2px 8px',
    fontSize: 10.5,
    color: C.dim,
  },
  spark: { display: 'flex', alignItems: 'flex-end', gap: 2, height: 12, flexShrink: 0 },
  compareBar: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    padding: '9px 12px',
    borderTop: `1px solid ${C.border}`,
    fontSize: 11,
    color: C.faint,
  },
  compareDotA: { width: 6, height: 6, borderRadius: 999, background: C.red },
  compareDotB: { width: 6, height: 6, borderRadius: 999, background: C.accent },
  compareBtn: {
    marginLeft: 'auto',
    border: `1px solid rgba(200,255,0,.35)`,
    color: C.accent,
    borderRadius: 6,
    padding: '3px 10px',
    fontSize: 11,
  },

  // capability strip
  capsSection: { padding: '96px 0', borderTop: `1px solid ${C.border}` },
  capsGridWrap: {
    marginTop: 28,
    border: `1px solid ${C.borderStrong}`,
    borderRadius: 8,
    overflow: 'hidden',
    background: C.borderStrong,
  },
  capGroup: { background: C.surface, padding: '18px 18px 20px' },
  capTitle: {
    fontFamily: MONO,
    fontSize: 10,
    letterSpacing: '0.22em',
    textTransform: 'uppercase',
    color: C.accent,
    marginBottom: 12,
  },
  capItem: { fontFamily: MONO, fontSize: 12, color: C.dim, padding: '3px 0' },

  // faq
  faqSection: { padding: '96px 0', borderTop: `1px solid ${C.border}` },
  faqGridWrap: {
    marginTop: 28,
    border: `1px solid ${C.borderStrong}`,
    borderRadius: 8,
    overflow: 'hidden',
    background: C.borderStrong,
  },
  faqItem: { background: C.surface, padding: '20px 22px' },
  faqQ: { fontFamily: MONO, fontSize: 13, color: C.text, marginBottom: 8 },
  faqA: { fontSize: 13, color: C.dim },

  // footer
  footer: { borderTop: `1px solid ${C.border}`, padding: '48px 0 56px' },
  footerTop: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 24 },
  footerClaim: { color: C.faint, fontSize: 13, marginTop: 8 },
  footerLinks: { display: 'flex', gap: 24, flexWrap: 'wrap', alignItems: 'center', justifyContent: 'flex-end' },
  footerLink: { fontFamily: MONO, fontSize: 12, lineHeight: 1 },
  footerBottom: {
    marginTop: 40,
    paddingTop: 20,
    borderTop: `1px solid ${C.border}`,
    fontFamily: MONO,
    fontSize: 11,
    color: C.faint,
    display: 'flex',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
    gap: 12,
  },
}

// ---------------------------------------------------------------- bits

function Sparkline({ heights = [4, 6, 8, 10, 12, 6, 10] }) {
  return (
    <span style={s.spark} aria-hidden="true">
      {heights.map((h, i) => (
        <span
          key={i}
          style={{
            width: 3,
            height: h,
            background: C.accent,
            opacity: i === heights.length - 1 ? 1 : 0.4,
            borderRadius: 1,
          }}
        />
      ))}
    </span>
  )
}

function HeroVisual() {
  return (
    <div style={s.heroVisual} aria-label="animated demo: a webhook lands and an AI agent explains the failure via MCP">
      <div className="phf-hero-grid">
        {/* left — the inbox */}
        <div className="phf-pane-left" style={s.paneLeft}>
          <div style={s.paneHead}>
            <span>inbox · /i/x9k2</span>
            <span style={s.liveChip}>
              <span className="phv-pulse" style={s.liveDot} /> live
            </span>
          </div>
          <div style={s.paneBody}>
            <div style={s.reqRow}>
              <span style={s.method}>POST</span>
              <span style={s.path}>invoice.paid</span>
              <span style={s.st200}>200</span>
              <span style={s.rowTime}>4m</span>
            </div>
            <div style={s.reqRow}>
              <span style={s.method}>POST</span>
              <span style={s.path}>invoice.paid</span>
              <span style={s.st200}>200</span>
              <span style={s.rowTime}>2m</span>
            </div>
            <div className="phv phv-row" style={{ ...s.reqRow, ...s.reqRowNew }}>
              <span style={s.rowDot} />
              <span style={s.method}>POST</span>
              <span style={s.path}>invoice.payment_failed</span>
              <span style={s.st400}>400</span>
              <span style={s.rowTime}>now</span>
            </div>
          </div>
        </div>

        {/* right — the agent */}
        <div>
          <div style={s.paneHead}>
            <span>claude code</span>
            <span style={s.liveChip}>mcp · peekhook</span>
          </div>
          <div style={s.paneBody}>
            <div className="phv phv-ask" style={s.askLine}>
              <span style={s.askPrompt}>&gt;</span> why did the last stripe webhook fail?
            </div>
            <div className="phv phv-think" style={s.thinkLine}>
              thinking…
            </div>
            <div>
              <span className="phv phv-tool1" style={s.toolChip}>▸ peekhook.search_events</span>
              <span className="phv phv-tool2" style={s.toolChip}>▸ peekhook.diff_events</span>
            </div>
            <div className="phv phv-ans1" style={s.ansLine}>
              #48 is the first failure. diffed it against #47 — one field changed:
            </div>
            <div className="phv phv-ans2" style={s.diffBlock}>
              <span style={s.diffDel}>- "amount": 4200</span>
              <span style={s.diffAdd}>+ "amount": "4200"</span>
            </div>
            <div className="phv phv-ans3" style={s.ansLine}>
              amount became a string. your handler expects an integer — that's the 400.
              <span className="phv-caret" style={s.caret} />
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------- page

export default function Landing() {
  const navigate = useNavigate()
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)

  async function openInbox(tab = '') {
    if (busy) return
    setBusy(true)
    setErr(null)
    try {
      const inbox = await api.createInbox()
      navigate(`/i/${inbox.token}${tab}`, { state: { justCreated: true } })
    } catch (e) {
      setErr("couldn't mint an inbox — is the api reachable?")
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="phf-root" style={s.page}>
      <style>{css}</style>
      {err && (
        <div style={s.toast} role="alert" onClick={() => setErr(null)}>{err}</div>
      )}

      <div style={s.shell}>
        {/* nav */}
        <nav style={s.nav}>
          <a href="/" style={s.wordmark}>
            peekhook<span style={s.wordmarkDot}>.</span>
          </a>
          <div style={s.navLinks}>
            <a className="phf-link" style={s.navLink} href="/docs">docs</a>
            <a className="phf-link" style={s.navLink} href={GITHUB} target="_blank" rel="noreferrer">github</a>
            <a className="phf-link" style={s.navLink} href="#own">peekgrok</a>
            <button className="phf-cta phf-cta-primary" style={s.navCta} onClick={() => openInbox()} disabled={busy}>
              open an inbox
            </button>
          </div>
        </nav>

        {/* hero */}
        <header style={s.hero}>
          <div style={s.eyebrow}>
            open source <span style={s.eyebrowMark}>·</span> mcp built in <span style={s.eyebrowMark}>·</span> runs local
          </div>
          <h1 style={s.h1}>the webhook inspector your AI can read.</h1>
          <p style={s.heroSub}>
            catch any http request in one click and watch it stream in live. then the part
            nobody else has: paste one url into claude code, cursor, or cline and your agent
            searches, diffs, and explains the captures itself. no copy-pasting json into chat.
            no signup. gone in 7 days.
          </p>
          <div style={s.heroCtas}>
            <button className="phf-cta phf-cta-primary" style={s.ctaPrimary} onClick={() => openInbox()} disabled={busy}>
              {busy ? 'minting…' : 'open an inbox →'}
            </button>
            <a className="phf-cta phf-cta-ghost" style={s.ctaGhost} href={GITHUB} target="_blank" rel="noreferrer">
              view source
            </a>
          </div>
          <div style={s.heroHint}>
            or keep it local: <span style={s.heroHintCmd}>npx peekgrok listen --to 8080</span>
          </div>
          <HeroVisual />
        </header>

        {/* act 1 — query */}
        <section style={s.act} id="query">
          <div className="phf-act">
            <div className="phf-act-copy">
              <div style={s.actEyebrow}>
                <span style={s.actNum}>act 1 · query</span> — your agent reads the inbox
              </div>
              <h2 style={s.h2}>stop pasting json into chat.</h2>
              <p style={s.actBody}>
                every inbox is also an <span style={s.actStrong}>mcp server</span>. one url,
                one bearer token, zero install — paste it into claude code, cursor, or cline
                and your agent gets five tools against your live webhook history. it can find
                the capture that broke, diff it against the one that didn't, and tell you what
                changed — while you keep typing.
              </p>
              <p style={s.actBody}>
                and it's <span style={s.actStrong}>your agent, your model</span> — the one you
                already use — not a canned mini-model wired in behind a paywall. the incumbents
                show you the payload; peekhook lets the ai you already trust{' '}
                <span style={s.actStrong}>reason about it</span>. nobody else ships this.
              </p>
              <div style={s.toolList}>
                <span style={s.toolPill}>list_events</span>
                <span style={s.toolPill}>get_event</span>
                <span style={s.toolPill}>search_events</span>
                <span style={s.toolPill}>diff_events</span>
                <span style={s.toolPill}>explain_event</span>
              </div>
              <button className="phf-minicta" style={s.miniCta} onClick={() => openInbox('/mcp')} disabled={busy}>
                grab your mcp url →
              </button>
            </div>
            <div style={s.term}>
              <div style={s.termHead}><span>terminal</span></div>
              <div style={s.termBody}>
                <div><span style={s.prompt}>$</span> claude mcp add --transport http \</div>
                <div>&nbsp;&nbsp;&nbsp;&nbsp;peekhook {SITE}/mcp</div>
                <div style={s.tDim}># auth: Authorization: Bearer &lt;mcp_token&gt;</div>
                <div><span style={s.tOk}>✓</span> connected · <span style={s.tStrong}>5 tools</span></div>
                <div style={s.tDim}>&nbsp;&nbsp;list_events · get_event · search_events</div>
                <div style={s.tDim}>&nbsp;&nbsp;diff_events · explain_event</div>
              </div>
            </div>
          </div>
        </section>

        {/* act 2 — inspect */}
        <section style={s.act} id="inspect">
          <div className="phf-act phf-act-flip">
            <div className="phf-act-copy">
              <div style={s.actEyebrow}>
                <span style={s.actNum}>act 2 · inspect</span> — the browser inbox
              </div>
              <h2 style={s.h2}>catching webhooks is the easy part.</h2>
              <p style={s.actBody}>
                mint an inbox, point anything at it, watch requests stream in live over sse —
                method, headers, query, body, ip. honestly? webhook.site does that part too.
                table stakes.
              </p>
              <p style={s.actBody}>
                so we kept going: <span style={s.actStrong}>full-text search across bodies</span>,
                filters by method, path, or header,{' '}
                <span style={s.actStrong}>side-by-side diff of any two captures</span>, and
                sparklines that show your payload schema drifting release by release. plus a
                programmable mock reply — status, content-type, body, a 0–30s delay, even a
                sandboxed script — so you can make your webhook sender fail on purpose and
                watch how it retries.
              </p>
              <button className="phf-minicta" style={s.miniCta} onClick={() => openInbox()} disabled={busy}>
                open an inbox →
              </button>
            </div>
            <div style={s.term}>
              <div style={s.termHead}>
                <span>inbox · /i/x9k2</span>
                <span style={s.liveChip}><span className="phv-pulse" style={s.liveDot} /> live</span>
              </div>
              <div style={s.searchBar}>
                <span>⌕</span>
                <span style={s.tStrong}>payment_failed</span>
                <span style={s.fieldPill}>body</span>
              </div>
              <div style={{ ...s.termBody, padding: '8px 10px' }}>
                <div style={s.reqRow}>
                  <span style={s.method}>POST</span>
                  <span style={s.path}>invoice.paid</span>
                  <Sparkline heights={[4, 6, 8, 6, 8]} />
                  <span style={s.rowTime}>9m</span>
                </div>
                <div style={{ ...s.reqRow, background: C.accent10, color: C.text }}>
                  <span style={s.method}>POST</span>
                  <span style={s.path}>invoice.payment_failed</span>
                  <Sparkline heights={[4, 6, 8, 6, 12]} />
                  <span style={s.rowTime}>now</span>
                </div>
                <div style={s.reqRow}>
                  <span style={s.method}>PUT</span>
                  <span style={s.path}>customer.updated</span>
                  <Sparkline heights={[6, 6, 8, 10]} />
                  <span style={s.rowTime}>1h</span>
                </div>
              </div>
              <div style={s.compareBar}>
                <span style={s.compareDotA} /> #47
                <span style={s.compareDotB} /> #48
                <span style={s.compareBtn}>show diff</span>
              </div>
            </div>
          </div>
        </section>

        {/* act 3 — own */}
        <section style={s.act} id="own">
          <div className="phf-act">
            <div className="phf-act-copy">
              <div style={s.actEyebrow}>
                <span style={s.actNum}>act 3 · own</span> — local-first cli
              </div>
              <h2 style={s.h2}>or keep every byte on your machine.</h2>
              <p style={s.actBody}>
                <span style={s.inlineMono}>peekgrok</span> is the whole stack in a single
                binary: same inbox, same inspector, same mcp server — running over sqlite in{' '}
                <span style={s.inlineMono}>~/.peekhook</span>. no cloud, no signup, no mongo.
              </p>
              <p style={s.actBody}>
                point it at your app and it becomes a{' '}
                <span style={s.actStrong}>transparent sniffer</span>: traffic flows through
                untouched while it captures every request <em>and</em> its response, stored
                locally in sqlite. the public url is an ngrok tunnel it drives for you — so
                bring your own ngrok (installed &amp; authed) — or pass{' '}
                <span style={s.inlineMono}>--no-tunnel</span> and nothing leaves the laptop.
              </p>
              <a
                className="phf-minicta"
                style={s.miniCta}
                href={`${GITHUB}/tree/main/apps/cli`}
                target="_blank"
                rel="noreferrer"
              >
                install peekgrok →
              </a>
            </div>
            <div style={s.term}>
              <div style={s.termHead}><span>peekgrok · local</span></div>
              <div style={s.termBody}>
                <div><span style={s.prompt}>$</span> npx peekgrok listen --to 8080</div>
                <div><span style={s.tOk}>●</span> up · sqlite: ~/.peekhook/peekgrok.db</div>
                <div style={s.tDim}>&nbsp;&nbsp;inspect&nbsp;&nbsp;http://localhost:4041</div>
                <div style={s.tDim}>&nbsp;&nbsp;tunnel&nbsp;&nbsp;&nbsp;https://calm-fox.ngrok.app (optional)</div>
                <div style={s.tDim}>&nbsp;&nbsp;mode&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;sniffer → req + res captured</div>
                <div>&nbsp;</div>
                <div><span style={s.tStrong}>POST</span> /webhooks/stripe <span style={s.tOk}>→ 200</span> · 38ms</div>
                <div><span style={s.tStrong}>POST</span> /webhooks/stripe <span style={s.tRed}>→ 400</span> · 11ms</div>
              </div>
            </div>
          </div>
        </section>

        {/* capability strip */}
        <section style={s.capsSection}>
          <div style={s.actEyebrow}>everything else the inbox does</div>
          <h2 style={{ ...s.h2, fontSize: 'clamp(24px, 3vw, 32px)' }}>
            dense on purpose. read it diagonally.
          </h2>
          <div className="phf-caps" style={s.capsGridWrap}>
            <div style={s.capGroup}>
              <div style={s.capTitle}>capture</div>
              <div style={s.capItem}>post · put · patch · delete</div>
              <div style={s.capItem}>get (non-browser clients)</div>
              <div style={s.capItem}>live sse stream</div>
              <div style={s.capItem}>desktop notifications</div>
              <div style={s.capItem}>headers · query · body · ip</div>
            </div>
            <div style={s.capGroup}>
              <div style={s.capTitle}>query</div>
              <div style={s.capItem}>search across bodies</div>
              <div style={s.capItem}>filter method / path / header</div>
              <div style={s.capItem}>diff any two captures</div>
              <div style={s.capItem}>schema-drift sparklines</div>
              <div style={s.capItem}>5 mcp tools for agents</div>
            </div>
            <div style={s.capGroup}>
              <div style={s.capTitle}>respond</div>
              <div style={s.capItem}>mock status / type / body</div>
              <div style={s.capItem}>0–30s reply delay</div>
              <div style={s.capItem}>sandboxed reply scripting</div>
            </div>
            <div style={s.capGroup}>
              <div style={s.capTitle}>move</div>
              <div style={s.capItem}>replay · edit-and-replay</div>
              <div style={s.capItem}>forward to your backend</div>
              <div style={s.capItem}>export json (all / selected)</div>
              <div style={s.capItem}>share links to a capture</div>
            </div>
            <div style={s.capGroup}>
              <div style={s.capTitle}>hygiene</div>
              <div style={s.capItem}>self-destructs in 7 days</div>
              <div style={s.capItem}>clear inbox · bulk select</div>
              <div style={s.capItem}>no signup · no telemetry</div>
              <div style={s.capItem}>no cookies</div>
            </div>
          </div>
        </section>

        {/* faq */}
        <section style={s.faqSection}>
          <div style={s.actEyebrow}>faq</div>
          <h2 style={{ ...s.h2, fontSize: 'clamp(24px, 3vw, 32px)' }}>the questions you're about to ask.</h2>
          <div className="phf-faq" style={s.faqGridWrap}>
            <div style={s.faqItem}>
              <div style={s.faqQ}>is it open source?</div>
              <div style={s.faqA}>
                yes — all of it. the api, the inspector, the mcp server, and the peekgrok cli
                live in one public repo. read it, fork it, self-host it.
              </div>
            </div>
            <div style={s.faqItem}>
              <div style={s.faqQ}>can i run it all locally?</div>
              <div style={s.faqA}>
                yes. peekgrok is a single binary that runs the full stack over sqlite — inbox,
                inspector, mcp server, and a transparent request/response sniffer. captured
                data stays in ~/.peekhook. for a public url it wraps ngrok, so you'll need
                ngrok installed and authed for that — or pass --no-tunnel to stay entirely
                local.
              </div>
            </div>
            <div style={s.faqItem}>
              <div style={s.faqQ}>what exactly does my agent get?</div>
              <div style={s.faqA}>
                a streamable-http mcp server on your inbox with five tools: list_events,
                get_event, search_events, diff_events, explain_event. auth is one bearer
                token. works with claude code, cursor, cline — anything that speaks mcp.
              </div>
            </div>
            <div style={s.faqItem}>
              <div style={s.faqQ}>do i need an account?</div>
              <div style={s.faqA}>
                no. an inbox is just a url. mint one, use it, lose it. no email, no password,
                no cookies, no telemetry.
              </div>
            </div>
            <div style={s.faqItem}>
              <div style={s.faqQ}>where does my data live?</div>
              <div style={s.faqA}>
                hosted inboxes are ephemeral by design — everything auto-expires after 7 days.
                if that's still too much cloud, run peekgrok with --no-tunnel and nothing is
                sent anywhere at all.
              </div>
            </div>
            <div style={s.faqItem}>
              <div style={s.faqQ}>which requests does it capture?</div>
              <div style={s.faqA}>
                post, put, patch, delete — and get from non-browser clients (a browser get
                opens the inspector instead). every capture records method, headers, query,
                body, and source ip.
              </div>
            </div>
          </div>
        </section>

        {/* footer */}
        <footer style={s.footer}>
          <div style={s.footerTop}>
            <div>
              <div style={s.wordmark}>
                peekhook<span style={s.wordmarkDot}>.</span>
              </div>
              <div style={s.footerClaim}>webhooks your agent can read.</div>
            </div>
            <div style={s.footerLinks}>
              <button
                className="phf-link"
                style={{ ...s.footerLink, background: 'none', border: 'none', cursor: 'pointer', padding: 0, lineHeight: 1 }}
                onClick={() => openInbox()}
                disabled={busy}
              >
                open an inbox
              </button>
              <a className="phf-link" style={s.footerLink} href="#query">mcp</a>
              <a className="phf-link" style={s.footerLink} href="#own">peekgrok</a>
              <a className="phf-link" style={s.footerLink} href={GITHUB} target="_blank" rel="noreferrer">github</a>
            </div>
          </div>
          <div style={s.footerBottom}>
            <span>no signup · no telemetry · no cookies · inboxes self-destruct in 7 days</span>
            <span>{SITE.replace(/^https?:\/\//, '')}</span>
          </div>
        </footer>
      </div>
    </div>
  )
}
