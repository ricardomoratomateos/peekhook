import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../lib/api.js'

// User-facing documentation page. Same design language as the landing:
// monochrome canvas + electric-lime accent, Geist / Geist Mono, inline styles.

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

const SITE = 'https://peekhook.dev'
const GITHUB = 'https://github.com/ricardomoratomateos/peekhook'

const NAV = [
  { id: 'quickstart', label: 'quickstart' },
  { id: 'mcp', label: 'connect your agent' },
  { id: 'peekgrok', label: 'peekgrok (local)' },
  { id: 'mock', label: 'mock, delay & replay' },
  { id: 'api', label: 'api reference' },
  { id: 'self-host', label: 'self-hosting' },
]

const ENDPOINTS = [
  ['POST', '/api/inboxes', 'mint an inbox, returns token + mcp_token'],
  ['GET', '/api/inboxes/:token', 'inbox metadata'],
  ['GET', '/api/inboxes/:token/requests', 'paginated list of captures'],
  ['GET', '/api/inboxes/:token/requests/:id', 'single capture by id'],
  ['GET', '/api/inboxes/:token/export', 'download all captures as JSON'],
  ['DELETE', '/api/inboxes/:token/requests', 'clear captures + reset cap'],
  ['PUT', '/api/inboxes/:token/response', 'configure mock reply'],
  ['DELETE', '/api/inboxes/:token/response', 'clear mock reply'],
  ['PUT', '/api/inboxes/:token/forward', 'configure forward target'],
  ['POST', '/api/inboxes/:token/replay', 'replay an event (mock or forward)'],
  ['GET', '/api/inboxes/:token/stream', 'SSE stream of new captures'],
  ['POST', '/i/:token', 'capture endpoint (ingest)'],
  ['POST', '/mcp', 'MCP server (Streamable HTTP)'],
]

const css = `
  .dc-root { background: ${C.bg}; }
  .dc-root ::selection { background: ${C.accent}; color: ${C.accentInk}; }
  .dc-link { color: ${C.faint}; text-decoration: none; transition: color .13s ease; }
  .dc-link:hover { color: ${C.accent}; }
  .dc-side-link { color: ${C.dim}; text-decoration: none; display: block; padding: 6px 0; transition: color .13s ease; }
  .dc-side-link:hover { color: ${C.text}; }
  .dc-cta { transition: transform .13s ease, background .13s ease; }
  .dc-cta:hover { background: #d4ff33; transform: translateY(-1px); }

  .dc-layout { display: grid; grid-template-columns: 210px 1fr; gap: 48px; align-items: start; }
  .dc-side { position: sticky; top: 24px; }
  @media (max-width: 820px) {
    .dc-layout { grid-template-columns: 1fr; gap: 24px; }
    .dc-side { position: static; border-bottom: 1px solid ${C.border}; padding-bottom: 12px; }
    .dc-side-links { display: flex; flex-wrap: wrap; gap: 8px 18px; }
  }
`

function CodeBlock({ children }) {
  const [copied, setCopied] = useState(false)
  async function copy() {
    try {
      await navigator.clipboard.writeText(children)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch (_) {}
  }
  return (
    <div style={s.code}>
      <button style={s.copyBtn} onClick={copy} aria-label="Copy">{copied ? 'copied ✓' : 'copy'}</button>
      <pre style={s.pre}><code style={s.codeText}>{children}</code></pre>
    </div>
  )
}

export default function Docs() {
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
    <div className="dc-root" style={s.page}>
      <style>{css}</style>
      {err && <div style={s.toast} role="alert" onClick={() => setErr(null)}>{err}</div>}

      <div style={s.shell}>
        <nav style={s.nav}>
          <a href="/" style={s.wordmark}>peekhook<span style={s.dot}>.</span></a>
          <div style={s.navLinks}>
            <a className="dc-link" style={s.navLink} href="/">home</a>
            <a className="dc-link" style={s.navLink} href={GITHUB} target="_blank" rel="noreferrer">github</a>
            <button className="dc-cta" style={s.navCta} onClick={() => openInbox()} disabled={busy}>
              {busy ? 'minting…' : 'open an inbox'}
            </button>
          </div>
        </nav>

        <header style={s.head}>
          <div style={s.eyebrow}>docs</div>
          <h1 style={s.h1}>how peekhook works.</h1>
          <p style={s.lead}>
            an open-source, anonymous webhook inspector with an mcp server built in. mint an
            inbox, point any http client at it, watch requests stream in live — and let your
            ai agent read them. runs hosted, or fully local via <span style={s.mono}>peekgrok</span>.
          </p>
        </header>

        <div className="dc-layout">
          <aside className="dc-side">
            <div style={s.sideHead}>on this page</div>
            <div className="dc-side-links">
              {NAV.map((n) => (
                <a key={n.id} className="dc-side-link" style={s.sideLink} href={`#${n.id}`}>{n.label}</a>
              ))}
            </div>
          </aside>

          <main style={s.main}>
            {/* quickstart */}
            <section id="quickstart" style={s.section}>
              <h2 style={s.h2}>quickstart</h2>
              <p style={s.p}>
                open <span style={s.mono}>{SITE}</span> and hit <b style={s.b}>open an inbox</b>.
                you land straight in the inspector with your capture url, a live feed, and an
                mcp token ready to paste — no signup, gone in 7 days.
              </p>
              <p style={s.step}>1 · open an inbox</p>
              <p style={s.p}>
                click <b style={s.b}>open an inbox</b> (top-right here, or the button on the
                home page). that's the whole step — no account, no config.
              </p>
              <div style={s.note}>
                <b style={s.b}>prefer the api?</b> the button just calls{' '}
                <span style={s.mono}>POST /api/inboxes</span> under the hood, so you can script
                it — handy in ci or a makefile:
              </div>
              <CodeBlock>{`curl -X POST ${SITE}/api/inboxes -d '{}'
# → { token, url, expiresAt, mcp_token }`}</CodeBlock>
              <p style={s.step}>2 · send a webhook to it</p>
              <CodeBlock>{`curl -X POST ${SITE}/i/<token> \\
  -H 'content-type: application/json' \\
  -d '{"event":"invoice.paid","amount":4200}'`}</CodeBlock>
              <p style={s.step}>3 · watch it land, live</p>
              <p style={s.p}>
                open <span style={s.mono}>{SITE}/i/&lt;token&gt;</span> — the request shows up
                instantly over sse with method, headers, query, body, ip, content-type and size.
              </p>
              <div style={s.note}>
                <b style={s.b}>which methods?</b> post, put, patch, delete — plus get from
                non-browser clients (oauth callbacks, verification pings). a browser get
                (<span style={s.mono}>Accept: text/html</span>) returns 405, since that path
                is the inspector ui.
              </div>
            </section>

            {/* mcp */}
            <section id="mcp" style={s.section}>
              <h2 style={s.h2}>connect your agent (mcp)</h2>
              <p style={s.p}>
                every inbox is also an <b style={s.b}>mcp server</b> at{' '}
                <span style={s.mono}>POST /mcp</span> (streamable http transport). auth is a
                single bearer token — the <span style={s.mono}>mcp_token</span> returned when
                you mint the inbox. no per-tool credentials.
              </p>
              <p style={s.step}>claude code</p>
              <CodeBlock>{`claude mcp add --transport http \\
  peekhook ${SITE}/mcp \\
  --header "Authorization: Bearer <mcp_token>"`}</CodeBlock>
              <p style={s.step}>cursor / cline / any client — mcp config</p>
              <CodeBlock>{`{
  "mcpServers": {
    "peekhook": {
      "type": "http",
      "url": "${SITE}/mcp",
      "headers": { "Authorization": "Bearer <mcp_token>" }
    }
  }
}`}</CodeBlock>
              <p style={s.p}>then restart your agent and ask it to find the bug. it gets five tools:</p>
              <ul style={s.ul}>
                <li style={s.li}><span style={s.mono}>list_events</span> — recent captures</li>
                <li style={s.li}><span style={s.mono}>get_event</span> — one capture in full</li>
                <li style={s.li}><span style={s.mono}>search_events</span> — full-text across bodies</li>
                <li style={s.li}><span style={s.mono}>diff_events</span> — compare two captures</li>
                <li style={s.li}><span style={s.mono}>explain_event</span> — summarize a capture</li>
              </ul>
              <div style={s.note}>
                the mcp token never touches the server as plaintext — it's matched by SHA-256
                hash against your inbox. the inspector's mcp tab shows your token and the
                ready-to-paste config.
              </div>
            </section>

            {/* peekgrok */}
            <section id="peekgrok" style={s.section}>
              <h2 style={s.h2}>peekgrok — run it all locally</h2>
              <p style={s.p}>
                <span style={s.mono}>peekgrok</span> is a single binary that runs the whole
                stack — capture endpoint, inspector, sse, and the mcp server — on your machine
                over sqlite in <span style={s.mono}>~/.peekhook</span>. no mongo, no signup.
              </p>
              <p style={s.step}>install (from source — requires bun)</p>
              <CodeBlock>{`git clone ${GITHUB}
cd peekhook/apps/cli
bun install && bun run build
./dist/peekgrok listen --to 8080`}</CodeBlock>
              <div style={s.note}>a one-line <span style={s.mono}>npx peekgrok</span> installer is on the way.</div>

              <p style={s.step}>sniffer mode (<span style={s.mono}>--to</span>) — the ngrok inspector</p>
              <p style={s.p}>
                point <span style={s.mono}>--to</span> at your app and peekgrok becomes a
                transparent reverse proxy in front of it: every request is captured and
                forwarded, and the upstream <b style={s.b}>response</b> is recorded too.
              </p>
              <CodeBlock>{`peekgrok listen --to 8080
# public tunnel ─▶ peekgrok proxy (:4042, captured) ─▶ your app (:8080)
#                  inspector (:4041) ◀── you watch here, live`}</CodeBlock>

              <p style={s.step}>webhook-inbox mode (no <span style={s.mono}>--to</span>)</p>
              <p style={s.p}>
                without <span style={s.mono}>--to</span>, peekgrok is a classic webhook sink:
                it prints a ready-to-paste <span style={s.mono}>https://&lt;tunnel&gt;/i/&lt;token&gt;</span>.
              </p>

              <div style={s.note}>
                <b style={s.b}>the public url uses ngrok.</b> peekgrok drives an ngrok tunnel
                for you, so you'll need ngrok installed and authed. don't want a tunnel? pass{' '}
                <span style={s.mono}>--no-tunnel</span> and everything stays on localhost.
              </div>

              <p style={s.step}>flags</p>
              <ul style={s.ul}>
                <li style={s.li}><span style={s.mono}>--to &lt;port|url&gt;</span> — sniffer mode: forward all traffic to your app</li>
                <li style={s.li}><span style={s.mono}>--port &lt;port&gt;</span> — inspector / api / mcp port (default 4041)</li>
                <li style={s.li}><span style={s.mono}>--proxy-port &lt;port&gt;</span> — sniffer port ngrok tunnels (default 4042)</li>
                <li style={s.li}><span style={s.mono}>--ignore &lt;p1,p2&gt;</span> — path prefixes to forward but not capture (health checks, assets)</li>
                <li style={s.li}><span style={s.mono}>--no-tunnel</span> — skip ngrok, serve on localhost only</li>
                <li style={s.li}><span style={s.mono}>--ngrok-url &lt;domain&gt;</span> — use a reserved ngrok domain</li>
                <li style={s.li}><span style={s.mono}>--data-dir &lt;path&gt;</span> — db location (default ~/.peekhook)</li>
                <li style={s.li}><span style={s.mono}>--fresh</span> — force a new inbox instead of reusing the last one</li>
              </ul>
            </section>

            {/* mock & replay */}
            <section id="mock" style={s.section}>
              <h2 style={s.h2}>mock, delay & replay</h2>
              <p style={s.p}>
                point your integration at peekhook and break it on purpose. configure a mock
                reply and peekhook answers every capture with it.
              </p>
              <p style={s.step}>configure a mock reply (+ optional delay)</p>
              <CodeBlock>{`curl -X PUT ${SITE}/api/inboxes/<token>/response \\
  -H 'content-type: application/json' \\
  -d '{
    "status": 503,
    "contentType": "application/json",
    "body": "{\\"error\\":\\"payment_failed\\"}",
    "delayMs": 5000
  }'`}</CodeBlock>
              <p style={s.p}>
                <span style={s.mono}>delayMs</span> (0–30 000) simulates a slow / timing-out
                upstream so you can exercise your client's retry logic. the reply tab in the
                inspector also supports a sandboxed <b style={s.b}>script</b> for dynamic replies.
              </p>
              <p style={s.step}>forward to your real backend</p>
              <CodeBlock>{`curl -X PUT ${SITE}/api/inboxes/<token>/forward \\
  -H 'content-type: application/json' \\
  -d '{ "forwardTo": "https://your-app.example.com/webhook" }'`}</CodeBlock>
              <p style={s.step}>replay a capture (tweak & re-send)</p>
              <CodeBlock>{`curl -X POST ${SITE}/api/inboxes/<token>/replay \\
  -H 'content-type: application/json' \\
  -d '{
    "eventId": "<id>",
    "mode": "forward",
    "mutations": { "body": "{\\"amount\\":1500}" }
  }'`}</CodeBlock>
              <p style={s.p}>
                <span style={s.mono}>mode</span> is <span style={s.mono}>mock</span> (replay
                against the inbox's own reply) or <span style={s.mono}>forward</span> (re-send
                to the configured target). <span style={s.mono}>mutations</span> optionally
                overrides <span style={s.mono}>method</span>, <span style={s.mono}>path</span>,{' '}
                <span style={s.mono}>headers</span>, or <span style={s.mono}>body</span> first.
              </p>
            </section>

            {/* api reference */}
            <section id="api" style={s.section}>
              <h2 style={s.h2}>api reference</h2>
              <p style={s.p}>
                base url is the inbox host (hosted: <span style={s.mono}>{SITE}</span>; local:{' '}
                <span style={s.mono}>http://localhost:4041</span>). captures ingest at{' '}
                <span style={s.mono}>/i/:token</span>; everything else lives under{' '}
                <span style={s.mono}>/api</span>.
              </p>
              <div style={s.tableWrap}>
                <table style={s.table}>
                  <thead>
                    <tr>
                      <th style={s.th}>method</th>
                      <th style={s.th}>route</th>
                      <th style={s.th}>purpose</th>
                    </tr>
                  </thead>
                  <tbody>
                    {ENDPOINTS.map(([m, r, p]) => (
                      <tr key={r + m}>
                        <td style={s.tdMethod}>{m}</td>
                        <td style={s.tdRoute}>{r}</td>
                        <td style={s.td}>{p}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>

            {/* self-hosting */}
            <section id="self-host" style={s.section}>
              <h2 style={s.h2}>self-hosting</h2>
              <p style={s.p}>
                peekhook is open source — run the whole thing yourself. two ways:
              </p>
              <p style={s.step}>docker compose (mongo + api + web)</p>
              <CodeBlock>{`git clone ${GITHUB}
cd peekhook
docker compose up`}</CodeBlock>
              <p style={s.p}>
                brings up mongo, the fastify api, and an nginx-fronted web bundle with
                healthchecks and an sse-friendly proxy. inboxes and requests carry a 7-day TTL.
              </p>
              <p style={s.step}>fully local, no mongo</p>
              <p style={s.p}>
                use <span style={s.mono}>peekgrok</span> (see above) — same stack over sqlite,
                nothing to install but the binary.
              </p>
              <p style={s.step}>configuration</p>
              <ul style={s.ul}>
                <li style={s.li}><span style={s.mono}>MONGODB_URI</span> — any reachable mongo url (hosted target)</li>
                <li style={s.li}><span style={s.mono}>PORT</span> — api port (default 3000)</li>
                <li style={s.li}><span style={s.mono}>VITE_API_TARGET</span> — where the web dev server proxies /api (default http://localhost:3000)</li>
                <li style={s.li}><span style={s.mono}>VITE_WEB_URL</span> — public site url used in share links + snippets</li>
              </ul>
              <div style={s.note}>
                feature flags (<span style={s.mono}>sseEnabled</span>,{' '}
                <span style={s.mono}>mcpEnabled</span>, <span style={s.mono}>shareEnabled</span>)
                are passed to the <span style={s.mono}>buildApp</span> factory so hosted and
                local targets share one code path.
              </div>
            </section>

            <div style={s.footer}>
              <span style={s.footerMono}>open source · no signup · no telemetry · inboxes self-destruct in 7 days</span>
              <a className="dc-link" style={s.footerMono} href={GITHUB} target="_blank" rel="noreferrer">github ↗</a>
            </div>
          </main>
        </div>
      </div>
    </div>
  )
}

const s = {
  page: { minHeight: '100vh', background: C.bg, color: C.text, fontFamily: SANS, fontSize: 14, lineHeight: 1.6 },
  shell: { maxWidth: 1080, margin: '0 auto', padding: '0 24px 96px' },

  nav: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '20px 0', borderBottom: `1px solid ${C.border}` },
  wordmark: { fontFamily: MONO, fontSize: 15, fontWeight: 500, color: C.text, textDecoration: 'none' },
  dot: { color: C.accent },
  navLinks: { display: 'flex', alignItems: 'center', gap: 24 },
  navLink: { fontFamily: MONO, fontSize: 12 },
  navCta: { fontFamily: MONO, fontSize: 12, background: C.accent, color: C.accentInk, border: 'none', borderRadius: 6, padding: '8px 14px', cursor: 'pointer', fontWeight: 500 },

  head: { padding: '56px 0 40px', borderBottom: `1px solid ${C.border}`, marginBottom: 40 },
  eyebrow: { fontFamily: MONO, fontSize: 11, letterSpacing: '0.22em', textTransform: 'uppercase', color: C.faint },
  h1: { fontSize: 'clamp(34px, 5vw, 52px)', lineHeight: 1.02, letterSpacing: '-1.5px', fontWeight: 600, margin: '16px 0 0' },
  lead: { color: C.dim, fontSize: 16, maxWidth: 680, marginTop: 18 },

  sideHead: { fontFamily: MONO, fontSize: 10, letterSpacing: '0.22em', textTransform: 'uppercase', color: C.faint, marginBottom: 10 },
  sideLink: { fontFamily: MONO, fontSize: 12.5 },

  main: { minWidth: 0 },
  section: { paddingBottom: 44, marginBottom: 44, borderBottom: `1px solid ${C.border}` },
  h2: { fontSize: 24, fontWeight: 600, letterSpacing: '-0.5px', margin: '0 0 14px', scrollMarginTop: 24 },
  p: { color: C.dim, margin: '0 0 14px', maxWidth: 680 },
  step: { fontFamily: MONO, fontSize: 11, letterSpacing: '0.1em', textTransform: 'uppercase', color: C.faint, margin: '22px 0 8px' },
  b: { color: C.text, fontWeight: 600 },
  mono: { fontFamily: MONO, fontSize: '0.92em', color: C.text, background: C.surface2, padding: '1px 5px', borderRadius: 3 },

  ul: { margin: '0 0 14px', paddingLeft: 0, listStyle: 'none', maxWidth: 680 },
  li: { color: C.dim, padding: '4px 0 4px 16px', position: 'relative', borderLeft: `2px solid ${C.border}`, marginBottom: 2 },

  note: { background: C.surface, border: `1px solid ${C.border}`, borderLeft: `2px solid ${C.accent}`, borderRadius: 6, padding: '12px 16px', color: C.dim, fontSize: 13.5, margin: '16px 0', maxWidth: 680 },

  code: { position: 'relative', margin: '0 0 14px' },
  copyBtn: { position: 'absolute', top: 10, right: 10, fontFamily: MONO, fontSize: 10, color: C.dim, background: C.surface3, border: `1px solid ${C.borderStrong}`, borderRadius: 999, padding: '3px 10px', cursor: 'pointer', letterSpacing: '0.08em' },
  pre: { background: C.surface, border: `1px solid ${C.borderStrong}`, borderRadius: 8, padding: '16px 18px', overflow: 'auto', margin: 0 },
  codeText: { fontFamily: MONO, fontSize: 12.5, lineHeight: 1.6, color: C.text, whiteSpace: 'pre' },

  tableWrap: { border: `1px solid ${C.border}`, borderRadius: 8, overflow: 'hidden', overflowX: 'auto' },
  table: { width: '100%', borderCollapse: 'collapse', fontFamily: MONO, fontSize: 12.5 },
  th: { textAlign: 'left', padding: '10px 14px', color: C.faint, fontWeight: 500, fontSize: 10, letterSpacing: '0.16em', textTransform: 'uppercase', borderBottom: `1px solid ${C.border}`, background: C.surface },
  td: { padding: '9px 14px', color: C.dim, borderBottom: `1px solid ${C.border}` },
  tdMethod: { padding: '9px 14px', color: C.accent, borderBottom: `1px solid ${C.border}`, whiteSpace: 'nowrap' },
  tdRoute: { padding: '9px 14px', color: C.text, borderBottom: `1px solid ${C.border}`, whiteSpace: 'nowrap' },

  footer: { display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12, paddingTop: 8 },
  footerMono: { fontFamily: MONO, fontSize: 11, color: C.faint, letterSpacing: '0.04em' },

  toast: { position: 'fixed', bottom: 24, left: '50%', transform: 'translateX(-50%)', zIndex: 50, fontFamily: MONO, fontSize: 12.5, color: C.text, background: C.surface2, border: `1px solid ${C.red}`, borderRadius: 8, padding: '10px 16px', cursor: 'pointer', boxShadow: '0 8px 30px rgba(0,0,0,.5)' },
}
