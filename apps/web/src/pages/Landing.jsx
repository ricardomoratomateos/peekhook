import { useState } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { api } from '../lib/api.js'

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
  green10: 'rgba(200,255,0,0.10)',
  accent: '#c8ff00',
  accentInk: '#0a0a0a',
  sans: "'Geist', ui-sans-serif, system-ui, sans-serif",
  mono: "'Geist Mono', ui-monospace, 'SFMono-Regular', monospace",
}

const PLACEHOLDER_URL = 'https://peekhook.dev/mcp'
const PLACEHOLDER_TOKEN = '<paste-your-mcp-token>'

const SNIPPETS = {
  'claude code': {
    label: 'Claude Code',
    body: JSON.stringify(
      {
        mcpServers: {
          peekhook: {
            type: 'http',
            url: PLACEHOLDER_URL,
            headers: { Authorization: `Bearer ${PLACEHOLDER_TOKEN}` },
          },
        },
      },
      null,
      2
    ),
    lang: 'json',
  },
  cursor: {
    label: 'Cursor',
    body: JSON.stringify(
      {
        mcpServers: {
          peekhook: {
            url: PLACEHOLDER_URL,
            headers: { Authorization: `Bearer ${PLACEHOLDER_TOKEN}` },
          },
        },
      },
      null,
      2
    ),
    lang: 'json',
  },
  curl: {
    label: 'curl · any MCP client',
    body: [
      'curl -s -X POST ' + PLACEHOLDER_URL,
      '  -H "Content-Type: application/json"',
      '  -H "Authorization: Bearer ' + PLACEHOLDER_TOKEN + '"',
      '  -H "Accept: application/json, text/event-stream"',
      "  -d '{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"tools/list\"}'",
    ].join(' \\\n'),
    lang: 'bash',
  },
}

const CLIENTS = [
  { label: 'Claude Code' },
  { label: 'Cursor' },
  { label: 'Cline' },
  { label: 'any MCP client' },
]

const FEATURE_CARDS = [
  {
    key: 'inspector',
    eyebrow: 'inbox / live',
    title: 'live SSE inspector',
    blurb: 'every request the moment it lands. method, headers, query, body, ip, size — search across all of it without leaving the page.',
    mock: 'inspector',
  },
  {
    key: 'reply',
    eyebrow: 'reply / mock',
    title: 'mock any reply',
    blurb: '200, 503, a slow timeout, or a scripted chain. point your integration at peekhook and break it on purpose.',
    mock: 'reply',
  },
  {
    key: 'schema',
    eyebrow: 'schema / infer',
    title: 'see the shape drift',
    blurb: 'peekhook infers types from every body — string, number, array, object — and renders a sparkline of how the shape has moved over time.',
    mock: 'schema',
  },
  {
    key: 'diff',
    eyebrow: 'compare / diff',
    title: 'spot the regression',
    blurb: 'pick any two requests, get a side-by-side, line-level diff of headers and bodies. find the field your vendor renamed last tuesday.',
    mock: 'diff',
  },
]

const MOCK_CHAIN = [
  { label: 'request 1', status: '200 OK',            timing: '1s',    kind: 'simulated' },
  { label: 'request 2', status: '503 unavailable',   timing: '800ms', kind: 'simulated' },
  { label: 'request 3', status: '504 timeout',       timing: '30s',   kind: 'simulated' },
  { label: 'request 4', status: '200 OK (resumed)',  timing: '400ms', kind: 'forwarded' },
] 

const FAQS = [
  {
    q: 'is it free?',
    a: 'yes. no signup, no card, no telemetry. mint an inbox in one click.',
  },
  {
    q: 'how long do my inboxes live?',
    a: '7 days by default. on purpose — peekhook is ephemeral. when an inbox expires, every request stored against it is deleted.',
  },
  {
    q: 'do you log ip or fingerprints?',
    a: 'we store the remote ip that hit the inbox because that\'s what the inspector shows. nothing else is logged client-side; no analytics, no cookies.',
  },
  {
    q: 'which http methods are captured?',
    a: 'post, put, patch, delete on the ingest endpoint. get returns 405 by design — this is a webhook inspector, not a generic proxy.',
  },
  {
    q: 'can i use it with ngrok / cloudflare tunnel?',
    a: 'yes. point any client at your inbox url — local, tunneled, or hosted. the mock reply surface works for both inbound and callback flows.',
  },
  {
    q: 'can my ai agent read the inbox directly?',
    a: 'yes. peekhook exposes an MCP server at the same url. five tools — list_events, get_event, search_events, diff_events, explain_event — work with claude code, cursor, cline, and any mcp-compatible client.',
  },
] 

export default function SandboxEntry() {
  const navigate = useNavigate()
  const [status, setStatus] = useState('idle')
  const [errorMsg, setErrorMsg] = useState(null)
  const [activeTab, setActiveTab] = useState('claude code')
  const [copied, setCopied] = useState(null)

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

  function scrollToLive() {
    const el = document.getElementById('live')
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  async function copySnippet(key, body) {
    try {
      await navigator.clipboard.writeText(body)
      setCopied(key)
      setTimeout(() => setCopied((c) => (c === key ? null : c)), 1800)
    } catch (_) {}
  }

  return (
    <>
      <style>{`
        @keyframes sbpulse { 0%,100% { opacity: 1; } 50% { opacity: 0.3; } }
        @keyframes sbrise { from { opacity: 0; transform: translateY(12px); } to { opacity: 1; transform: none; } }
        .sb * { box-sizing: border-box; margin: 0; padding: 0; }
        .sb-rise { opacity: 0; animation: sbrise .65s cubic-bezier(.16,1,.3,1) forwards; }
        .sb-cta { transition: transform .15s cubic-bezier(.16,1,.3,1), background .15s; }
        .sb-cta:hover { transform: translateY(-1px); background: #d4ff1a; }
        .sb-cta:active { transform: translateY(0); }
        .sb-cta:disabled { opacity: .6; cursor: not-allowed; transform: none; }
        .sb-ghost { transition: color .15s, background .15s, border-color .15s; }
        .sb-ghost:hover { color: ${c.fg} !important; border-color: ${c.outline} !important; background: ${c.ctr} !important; }
        .sb-link { transition: color .15s; }
        .sb-link:hover { color: ${c.fg} !important; }
        .sb-card { transition: border-color .15s, background .15s; }
        .sb-card:hover { border-color: ${c.outline}; }
        .sb-tab { transition: color .15s, background .15s, border-color .15s; }
      `}</style>

      <div className="sb" style={s.page}>
        <nav style={s.nav}>
          <div style={s.navInner}>
            <Link to="/" className="sb-link" style={s.logo}>peekhook</Link>
            <div style={s.navRight}>
              <span style={s.navEyebrow}>live · anonymous · free</span>
            </div>
          </div>
        </nav>

        <main style={s.hero}>
          <div className="sb-rise" style={{ ...s.eyebrow, animationDelay: '.05s' }}>
            webhook inspector
          </div>

          <h1 className="sb-rise" style={{ ...s.h1, animationDelay: '.12s' }}>
            webhooks, in real time.
          </h1>
          <div className="sb-rise" style={{ ...s.h1Mono, animationDelay: '.18s' }}>
            capture. inspect. mock.
          </div>

          <p className="sb-rise" style={{ ...s.sub, animationDelay: '.28s' }}>
            mint a free inbox in one click. point any http client at the url —
            every request shows up live over sse, with method, headers, body,
            ip. when the bug is downstream, mock the reply and break it on
            purpose.
          </p>

          <div className="sb-rise" style={{ ...s.ctaWrap, animationDelay: '.38s' }}>
            <div style={s.ctaRow}>
              <button
                className="sb-cta"
                onClick={handleCreate}
                disabled={status === 'loading'}
                style={s.cta}
                aria-label="Generate a unique webhook inbox URL"
              >
                {status === 'loading' ? 'generating…' : 'open an inbox'}
              </button>
              <button
                className="sb-ghost"
                onClick={scrollToLive}
                style={s.ctaSecondary}
              >
                try the live strip ↓
              </button>
            </div>
            {errorMsg && <div style={s.error} role="alert">{errorMsg}</div>}
          </div>

          <div id="live" className="sb-rise" style={{ ...s.liveStrip, animationDelay: '.6s' }} aria-hidden>
            <div style={s.liveStripHead}>
              <span style={s.liveStripLabel}>live now ·</span>
              <span style={s.previewDot} />
              <span style={s.liveStripHint}>real requests, live SSE</span>
            </div>
            <div style={s.liveStripBody}>
              {PREVIEW_ROWS.slice(0, 3).map((row, i) => (
                <div key={i} style={s.liveRow}>
                  <span style={s.liveMethod}>{row.method.toLowerCase()}</span>
                  <span style={s.livePath}>{row.path}</span>
                  <span style={s.liveTime}>{row.time}</span>
                </div>
              ))}
            </div>
            <div style={s.liveStripFoot}>
              <span style={s.liveStripFootMono}>no signup · expires in 7 days</span>
            </div>
          </div>
        </main>

        <section style={s.features}>
          <div style={s.featuresInner}>
            <div style={s.sectionEyebrow}>the inspector · / 4 surfaces</div>
            <div style={s.sectionHead}>
              <span style={s.sectionHeadMono}>four tabs ·</span>
              <span style={s.sectionHeadSlash}>/</span>
              <span style={s.sectionHeadMono}>one inbox</span>
            </div>
            <p style={s.sectionSub}>
              every request your inbox catches is searchable, diffable, and
              mockable from the browser. no cli, no install, no sdk.
            </p>

            <div style={s.featureGrid}>
              {FEATURE_CARDS.map((f) => (
                <div key={f.key} className="sb-card" style={s.featureCard}>
                  <div style={s.featureCardHead}>
                    <span style={s.featureCardEyebrow}>{f.eyebrow}</span>
                  </div>
                  <h3 style={s.featureCardTitle}>{f.title}</h3>
                  <p style={s.featureCardBlurb}>{f.blurb}</p>
                  <div style={s.featureMock}>
                    {f.mock === 'inspector' && <InspectorMock />}
                    {f.mock === 'reply' && <ReplyMock />}
                    {f.mock === 'schema' && <SchemaMock />}
                    {f.mock === 'diff' && <DiffMock />}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section style={s.mockTease}>
          <div style={s.mockTeaseInner}>
            <div style={s.mockTeaseLeft}>
              <div style={s.sectionEyebrow}>mock the impossible</div>
              <div style={s.mockTeaseHead}>
                <span style={s.sectionHeadMono}>what</span>
                <span style={s.sectionHeadMono}>webhook.site</span>
                <span style={s.sectionHeadSlash}>/</span>
                <span style={s.sectionHeadMono}>can't simulate</span>
              </div>
              <p style={s.mockTeaseBlurb}>
                static replies are table stakes. peekhook's reply config
                supports scripted chains, timeouts, and forward-to-your-real-backend
                — so you can test your retry logic, your backoff, and your "the
                user closed the tab" flows without standing up a real broken
                server.
              </p>
              <div style={s.mockTeaseFooter}>
                configured in the reply tab · script mode
              </div>
            </div>
            <div style={s.mockTeaseRight}>
              <div style={s.chainCard}>
                <div style={s.chainHead}>
                  <span style={s.chainDot} />
                  <span style={s.chainHeadText}>reply chain · script mode</span>
                </div>
                <div style={s.chainList}>
                  {MOCK_CHAIN.map((node, i) => (
                    <div key={i} style={s.chainNode}>
                      <div style={s.chainConnector}>
                        <span style={s.chainMarker} />
                        {i < MOCK_CHAIN.length - 1 && <span style={s.chainLine} />}
                      </div>
                      <div style={s.chainBody}>
                        <div style={s.chainRow}>
                          <span style={s.chainLabel}>{node.label}</span>
                          <span style={s.chainTiming}>{node.timing}</span>
                        </div>
                        <div style={s.chainStatus}>{node.status}</div>
                        <div style={{
                          ...s.chainKind,
                          ...(node.kind === 'forwarded' ? s.chainKindForwarded : null),
                        }}>
                          {node.kind}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </section>

        <section id="mcp" style={s.mcpSection}>
          <div style={s.mcpInner}>
            <div style={s.sectionEyebrow}>for when you live in your agent</div>
            <div style={s.sectionHead}>
              <span style={s.sectionHeadMono}>paste one url</span>
              <span style={s.sectionHeadSlash}>/</span>
              <span style={s.sectionHeadMono}>into claude code</span>
            </div>
            <p style={s.sectionSub}>
              peekhook exposes an <span style={s.inlineMono}>mcp</span> server
              on the same inbox. five tools —{' '}
              <span style={s.inlineMono}>list_events</span>,{' '}
              <span style={s.inlineMono}>get_event</span>,{' '}
              <span style={s.inlineMono}>search_events</span>,{' '}
              <span style={s.inlineMono}>diff_events</span>,{' '}
              <span style={s.inlineMono}>explain_event</span> — so your agent
              can read every request your inbox receives. no copy-pasting json
              into chat.
            </p>

            <div style={s.mcpPicker}>
              <div style={s.mcpTabs}>
                {Object.entries(SNIPPETS).map(([key, sn]) => {
                  const active = activeTab === key
                  return (
                    <button
                      key={key}
                      onClick={() => setActiveTab(key)}
                      className="sb-tab"
                      style={{
                        ...s.tab,
                        ...(active ? s.tabActive : null),
                      }}
                    >
                      {sn.label}
                    </button>
                  )
                })}
              </div>
              <div style={s.mcpPickerBody}>
                <pre style={s.mcpPickerPre}>
                  <code style={s.terminalCode}>{SNIPPETS[activeTab].body}</code>
                </pre>
                <button
                  onClick={() => copySnippet(activeTab, SNIPPETS[activeTab].body)}
                  style={s.mcpCopyBtn}
                  aria-label="Copy snippet"
                >
                  {copied === activeTab ? 'copied ✓' : 'copy'}
                </button>
              </div>
            </div>

            <div style={s.mcpFooter}>
              <span style={s.mcpFooterMono}>paste the snippet · restart your agent · ask it to find the bug</span>
            </div>
          </div>
        </section>

        <section style={s.faq}>
          <div style={s.faqInner}>
            <div style={s.sectionEyebrow}>faq</div>
            <div style={s.sectionHead}>
              <span style={s.sectionHeadMono}>questions</span>
              <span style={s.sectionHeadSlash}>/</span>
              <span style={s.sectionHeadMono}>answered</span>
            </div>
            <div style={s.faqList}>
              {FAQS.map((item, i) => (
                <details key={i} style={s.faqItem}>
                  <summary style={s.faqQ}>{item.q}</summary>
                  <p style={s.faqA}>{item.a}</p>
                </details>
              ))}
            </div>
          </div>
        </section>

        <section style={s.finalCta}>
          <div style={s.finalCtaInner}>
            <div style={s.finalCtaEyebrow}>ready · one click</div>
            <h2 style={s.finalCtaTitle}>
              open an inbox.<br />
              <span style={s.finalCtaTitleMono}>or hand it to your agent.</span>
            </h2>
            <button
              className="sb-cta"
              onClick={handleCreate}
              disabled={status === 'loading'}
              style={{ ...s.cta, ...s.finalCtaBtn }}
              aria-label="Generate a unique webhook inbox URL"
            >
              {status === 'loading' ? 'generating…' : 'open an inbox →'}
            </button>
            <div style={s.finalCtaLinks}>
              <a href="#" className="sb-link" style={s.finalCtaLink} target="_blank" rel="noreferrer">docs</a>
              <span style={s.finalCtaDot}>·</span>
              <a href="#" className="sb-link" style={s.finalCtaLink} target="_blank" rel="noreferrer">status</a>
              <span style={s.finalCtaDot}>·</span>
              <a href="https://github.com/" className="sb-link" style={s.finalCtaLink} target="_blank" rel="noreferrer">github</a>
            </div>
          </div>
        </section>

        <footer style={s.footer}>
          <div style={s.footerTop}>
            <div style={s.footerBrand}>
              <span style={s.footerLogo}>peekhook</span>
                <span style={s.footerTagline}>webhook inspector · live, anonymous, free</span>
            </div>
            <div style={s.footerCols}>
              <div style={s.footerCol}>
                <div style={s.footerColHead}>product</div>
                <Link to="/" className="sb-link" style={s.footerLink}>inbox</Link>
                <a href="#mcp" className="sb-link" style={s.footerLink}>mcp / agents</a>
                <a href="https://peekhook.dev" className="sb-link" style={s.footerLink} target="_blank" rel="noreferrer">live site</a>
              </div>
              <div style={s.footerCol}>
                <div style={s.footerColHead}>resources</div>
                <a href="https://github.com/" className="sb-link" style={s.footerLink} target="_blank" rel="noreferrer">github</a>
                <a href="#" className="sb-link" style={s.footerLink} target="_blank" rel="noreferrer">status</a>
                <a href="#" className="sb-link" style={s.footerLink} target="_blank" rel="noreferrer">changelog</a>
              </div>
              <div style={s.footerCol}>
                <div style={s.footerColHead}>legal</div>
                <a href="#" className="sb-link" style={s.footerLink} target="_blank" rel="noreferrer">terms</a>
                <a href="#" className="sb-link" style={s.footerLink} target="_blank" rel="noreferrer">privacy</a>
              </div>
            </div>
          </div>
          <div style={s.footerBottom}>
            <span style={s.footerMeta}>inboxes auto-expire after 7 days · on purpose</span>
            <span style={s.footerMetaDim}>no signup · no telemetry · ephemeral</span>
          </div>
        </footer>
      </div>
    </>
  )
}

function InspectorMock() {
  return (
    <div style={s.mockFrame}>
      <div style={s.mockChrome}>
        <span style={s.mockDot} />
        <span style={s.mockDot} />
        <span style={s.mockDot} />
        <span style={s.mockSearch}>search requests…</span>
      </div>
      <div style={s.mockBody}>
        <div style={s.mockRow}>
          <span style={{ ...s.mockMethod, color: c.fg }}>post</span>
          <span style={s.mockPath}>/webhooks/stripe</span>
          <span style={s.mockTime}>2s</span>
          <span style={s.previewDot} />
        </div>
        <div style={s.mockRow}>
          <span style={{ ...s.mockMethod, color: c.fg }}>post</span>
          <span style={s.mockPath}>/orders/created</span>
          <span style={s.mockTime}>14s</span>
        </div>
        <div style={s.mockRow}>
          <span style={{ ...s.mockMethod, color: c.dim }}>get</span>
          <span style={s.mockPath}>/health</span>
          <span style={s.mockTime}>1m</span>
        </div>
        <div style={s.mockRow}>
          <span style={{ ...s.mockMethod, color: c.fg }}>put</span>
          <span style={s.mockPath}>/api/order/42</span>
          <span style={s.mockTime}>3m</span>
        </div>
      </div>
    </div>
  )
}

function ReplyMock() {
  return (
    <div style={s.mockFrame}>
      <div style={s.mockReplyHead}>
        <span style={s.mockReplyLabel}>response</span>
        <span style={s.mockPillOn}>● script · 200→503→200</span>
      </div>
      <div style={s.mockReplyBody}>
        <div style={s.mockReplyField}>
          <span style={s.mockFieldLabel}>status</span>
          <span style={s.mockFieldVal}>503 service unavailable</span>
        </div>
        <div style={s.mockReplyField}>
          <span style={s.mockFieldLabel}>content-type</span>
          <span style={s.mockFieldVal}>application/json</span>
        </div>
        <pre style={s.mockReplyJson}>{`{
  "error": "payment_failed",
  "retry_after": 60
}`}</pre>
      </div>
    </div>
  )
}

function SchemaMock() {
  return (
    <div style={s.mockFrame}>
      <div style={s.mockChrome}>
        <span style={s.mockDot} />
        <span style={s.mockDot} />
        <span style={s.mockDot} />
        <span style={s.mockSearch}>fields · 4</span>
      </div>
      <div style={s.mockSchema}>
        <div style={s.mockSchemaRow}>
          <span style={s.mockFieldName}>id</span>
          <span style={s.mockTypeTag}>number</span>
          <span style={s.mockSpark} />
        </div>
        <div style={s.mockSchemaRow}>
          <span style={s.mockFieldName}>created_at</span>
          <span style={s.mockTypeTag}>string</span>
          <span style={s.mockSpark} />
        </div>
        <div style={s.mockSchemaRow}>
          <span style={s.mockFieldName}>items</span>
          <span style={{ ...s.mockTypeTag, color: c.accent, borderColor: c.accent }}>array</span>
          <span style={s.mockSpark} />
        </div>
        <div style={s.mockSchemaRow}>
          <span style={s.mockFieldName}>customer</span>
          <span style={s.mockTypeTag}>object</span>
          <span style={s.mockSpark} />
        </div>
      </div>
    </div>
  )
}

function DiffMock() {
  return (
    <div style={s.mockFrame}>
      <div style={s.mockChrome}>
        <span style={s.mockDot} />
        <span style={s.mockDot} />
        <span style={s.mockDot} />
        <span style={s.mockSearch}>compare 1 / 2</span>
      </div>
      <div style={s.mockDiff}>
        <div style={s.mockDiffRow}>
          <span style={s.mockDiffA}>A</span>
          <span style={s.mockDiffMethod}>post</span>
          <span style={s.mockDiffPath}>/webhook</span>
          <span style={s.mockDiffTime}>10:14</span>
        </div>
        <div style={s.mockDiffRow}>
          <span style={{ ...s.mockDiffA, background: c.accent, color: c.accentInk }}>B</span>
          <span style={s.mockDiffMethod}>post</span>
          <span style={s.mockDiffPath}>/webhook</span>
          <span style={s.mockDiffTime}>10:21</span>
        </div>
        <div style={s.mockDiffBody}>
          <div style={s.mockDiffLine}>
            <span style={s.mockDiffMinus}>−</span>
            <span style={s.mockDiffTextOld}>"amount": 1200</span>
          </div>
          <div style={s.mockDiffLine}>
            <span style={s.mockDiffPlus}>+</span>
            <span style={s.mockDiffTextNew}>"amount": 1500</span>
          </div>
          <div style={s.mockDiffLine}>
            <span style={s.mockDiffPlus}>+</span>
            <span style={s.mockDiffTextNew}>"currency": "eur"</span>
          </div>
        </div>
      </div>
    </div>
  )
}

const PREVIEW_ROWS = [
  { method: 'POST', path: '/webhook/example', time: '2s ago' },
  { method: 'POST', path: '/orders/created', time: '14s ago' },
  { method: 'GET',  path: '/health',         time: '1m ago' },
] 

const mono = (extra = {}) => ({
  fontFamily: c.mono,
  fontSize: '12px',
  color: c.fg,
  ...extra,
})

const s = {
  page: { minHeight: '100vh', background: c.bg, color: c.fg, fontFamily: c.sans, fontSize: '14px', display: 'flex', flexDirection: 'column', position: 'relative' },
  nav: { borderBottom: `1px solid ${c.borderSoft}`, flexShrink: 0, position: 'sticky', top: 0, background: c.bg, zIndex: 2 },
  navInner: { maxWidth: '1000px', margin: '0 auto', padding: '0 24px', height: '56px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' },
  logo: { fontSize: '14px', fontWeight: 500, color: c.fg, textDecoration: 'none', letterSpacing: '-0.2px' },
  navRight: { display: 'flex', alignItems: 'center', gap: '22px' },
  navEyebrow: { fontFamily: c.mono, fontSize: '11px', color: c.faint, letterSpacing: '0.22em', textTransform: 'uppercase' },

  hero: { width: '100%', maxWidth: '720px', margin: '0 auto', padding: '80px 24px 64px', display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', flexShrink: 0 },
  eyebrow: { fontFamily: c.mono, fontSize: '11px', color: c.dim, letterSpacing: '0.24em', textTransform: 'uppercase', marginBottom: '24px', opacity: 0.85 },
  h1: { fontSize: 'clamp(48px, 7vw, 84px)', fontWeight: 450, color: '#ffffff', lineHeight: 0.95, letterSpacing: '-3px', marginBottom: '4px' },
  h1Mono: { fontFamily: c.mono, fontSize: '22px', fontWeight: 500, color: c.dim, letterSpacing: '-0.5px', marginBottom: '28px', textAlign: 'left', paddingLeft: '0.6em' },
  sub: { fontSize: '16px', color: c.dim, lineHeight: 1.55, maxWidth: '480px', marginBottom: '36px' },
  ctaWrap: { display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '14px', marginBottom: '40px' },
  ctaRow: { display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap', justifyContent: 'center' },
  cta: { background: c.accent, color: c.accentInk, border: 'none', borderRadius: '4px', padding: '13px 24px', fontSize: '14px', fontWeight: 500, fontFamily: c.sans, cursor: 'pointer' },
  ctaSecondary: { background: 'transparent', color: c.dim, border: `1px solid ${c.outline}`, borderRadius: '4px', padding: '12px 18px', fontSize: '13px', fontFamily: c.mono, fontWeight: 400, cursor: 'pointer', letterSpacing: '0.02em' },
  error: { padding: '8px 14px', background: c.low, border: `1px solid ${c.outline}`, borderRadius: '4px', color: c.dim, fontSize: '13px' },

  terminal: { width: '100%', maxWidth: '560px', background: c.low, border: `1px solid ${c.border}`, borderRadius: '8px', overflow: 'hidden', textAlign: 'left' },
  terminalChrome: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 12px', borderBottom: `1px solid ${c.borderSoft}`, background: c.lowest },
  terminalDots: { display: 'flex', gap: '6px' },
  dot: { width: '8px', height: '8px', borderRadius: '50%', background: c.outline, display: 'inline-block' },
  terminalTabs: { display: 'flex', gap: '4px' },
  tab: { fontFamily: c.mono, fontSize: '10px', color: c.faint, background: 'transparent', border: `1px solid transparent`, borderRadius: '999px', padding: '4px 10px', cursor: 'pointer', textTransform: 'uppercase', letterSpacing: '0.16em' },
  tabActive: { color: c.fg, background: c.green10, border: `1px solid ${c.accent}` },
  terminalBody: { padding: '18px 18px', margin: 0, overflow: 'auto' },
  terminalCode: { fontFamily: c.mono, fontSize: '12.5px', lineHeight: 1.55, color: c.dim, whiteSpace: 'pre' },

  liveStrip: { width: '100%', maxWidth: '560px', marginTop: '24px', textAlign: 'left' },
  liveStripHead: { display: 'flex', alignItems: 'center', gap: '8px', padding: '0 4px 8px', borderBottom: `1px solid ${c.borderSoft}`, marginBottom: '4px' },
  liveStripLabel: { fontFamily: c.mono, fontSize: '10px', color: c.faint, letterSpacing: '0.22em', textTransform: 'uppercase' },
  liveStripHint: { fontFamily: c.mono, fontSize: '10px', color: c.faint, letterSpacing: '0.06em', marginLeft: 'auto' },
  previewDot: { width: '6px', height: '6px', borderRadius: '50%', background: c.accent, animation: 'sbpulse 2s ease infinite' },
  liveStripBody: { display: 'flex', flexDirection: 'column' },
  liveRow: { display: 'flex', alignItems: 'center', gap: '12px', padding: '7px 4px', fontFamily: c.mono, fontSize: '12px', borderBottom: `1px solid ${c.borderSoft}` },
  liveMethod: { width: '54px', flexShrink: 0, fontSize: '11px', color: c.dim },
  livePath: { flex: 1, color: c.dim, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  liveTime: { width: '56px', textAlign: 'right', color: c.faint, fontSize: '11px', flexShrink: 0 },

  section: { borderTop: `1px solid ${c.borderSoft}`, padding: '64px 24px', background: c.lowest, flexShrink: 0 },
  sectionInner: { maxWidth: '1000px', margin: '0 auto', display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center' },
  sectionEyebrow: { fontFamily: c.mono, fontSize: '11px', color: c.dim, letterSpacing: '0.24em', textTransform: 'uppercase', opacity: 0.8, marginBottom: '20px' },
  sectionHead: { display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '20px' },
  sectionHeadMono: { fontFamily: c.mono, fontSize: '22px', fontWeight: 500, color: c.fg, letterSpacing: '-0.5px' },
  sectionHeadSlash: { fontFamily: c.mono, fontSize: '22px', color: c.outline, fontWeight: 400 },
  sectionSub: { fontSize: '15px', color: c.dim, lineHeight: 1.6, maxWidth: '560px', marginBottom: '40px' },
  inlineMono: { fontFamily: c.mono, fontSize: '13px', color: c.fg, background: c.ctr, padding: '1px 6px', borderRadius: '3px' },

  cards: { display: 'flex', gap: '16px', width: '100%', maxWidth: '960px', flexWrap: 'wrap', justifyContent: 'center' },
  card: { flex: '1 1 280px', minWidth: '0', background: c.ctr, border: `1px solid ${c.border}`, borderRadius: '8px', textAlign: 'left', display: 'flex', flexDirection: 'column', overflow: 'hidden' },
  cardActive: { border: `1px solid ${c.outline}` },
  cardHead: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 14px', borderBottom: `1px solid ${c.borderSoft}`, background: c.low },
  cardLabel: { fontFamily: c.mono, fontSize: '10px', color: c.fg, letterSpacing: '0.22em', textTransform: 'uppercase' },
  copyBtn: { fontFamily: c.mono, fontSize: '10px', color: c.dim, background: 'transparent', border: `1px solid ${c.border}`, borderRadius: '999px', padding: '3px 10px', cursor: 'pointer', letterSpacing: '0.16em', textTransform: 'uppercase' },
  cardBody: { padding: '14px', margin: 0, overflow: 'auto', maxHeight: '240px' },
  cardCode: { fontFamily: c.mono, fontSize: '11.5px', lineHeight: 1.55, color: c.dim, whiteSpace: 'pre', display: 'block' },

  featStrip: { borderTop: `1px solid ${c.borderSoft}`, borderBottom: `1px solid ${c.borderSoft}`, padding: '20px 24px', background: c.bg, flexShrink: 0 },
  featStripInner: { maxWidth: '1000px', margin: '0 auto', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '28px', flexWrap: 'wrap' },
  featItem: { display: 'inline-flex', alignItems: 'center', gap: '6px', fontFamily: c.mono, fontSize: '11px', color: c.dim, letterSpacing: '0.06em' },
  featDot: { width: '6px', height: '6px', borderRadius: '50%', background: c.accent, animation: 'sbpulse 2s ease infinite' },

  footer: { borderTop: `1px solid ${c.borderSoft}`, padding: '48px 24px 28px', maxWidth: '1000px', margin: '0 auto', width: '100%', flexShrink: 0, display: 'flex', flexDirection: 'column', gap: '32px' },
  footerTop: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '32px', flexWrap: 'wrap' },
  footerBrand: { display: 'flex', flexDirection: 'column', gap: '6px' },
  footerLogo: { fontSize: '15px', fontWeight: 500, color: c.fg, letterSpacing: '-0.2px' },
  footerTagline: { fontFamily: c.mono, fontSize: '11px', color: c.faint, letterSpacing: '0.04em' },
  footerCols: { display: 'flex', gap: '48px', flexWrap: 'wrap' },
  footerCol: { display: 'flex', flexDirection: 'column', gap: '8px', minWidth: '88px' },
  footerColHead: { fontFamily: c.mono, fontSize: '10px', color: c.dim, letterSpacing: '0.22em', textTransform: 'uppercase', marginBottom: '4px' },
  footerLink: { fontFamily: c.mono, fontSize: '12px', color: c.faint, textDecoration: 'none', letterSpacing: '0.04em' },
  footerBottom: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderTop: `1px solid ${c.borderSoft}`, paddingTop: '20px', flexWrap: 'wrap', gap: '12px' },
  footerMeta: { fontFamily: c.mono, fontSize: '11px', color: c.faint, letterSpacing: '0.04em' },
  footerMetaDim: { fontFamily: c.mono, fontSize: '11px', color: c.outline, letterSpacing: '0.04em' },

  clientRow: { display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap', justifyContent: 'center', marginTop: '40px' },
  clientRowLabel: { fontFamily: c.mono, fontSize: '10px', color: c.faint, letterSpacing: '0.22em', textTransform: 'uppercase', marginRight: '8px' },
  clientChip: { fontFamily: c.mono, fontSize: '11px', color: c.dim, padding: '5px 10px', border: `1px solid ${c.borderSoft}`, borderRadius: '999px', letterSpacing: '0.04em' },

  features: { borderTop: `1px solid ${c.borderSoft}`, background: c.lowest, padding: '80px 24px' },
  featuresInner: { maxWidth: '1080px', margin: '0 auto', display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center' },
  featureGrid: { display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '16px', width: '100%', marginTop: '40px', textAlign: 'left' },
  featureCard: { background: c.ctr, border: `1px solid ${c.border}`, borderRadius: '8px', padding: '20px', display: 'flex', flexDirection: 'column', gap: '12px', overflow: 'hidden' },
  featureCardHead: { display: 'flex', alignItems: 'center', justifyContent: 'space-between' },
  featureCardEyebrow: { fontFamily: c.mono, fontSize: '10px', color: c.faint, letterSpacing: '0.22em', textTransform: 'uppercase' },
  featureCardTitle: { fontSize: '20px', fontWeight: 500, color: c.fg, letterSpacing: '-0.4px', lineHeight: 1.2 },
  featureCardBlurb: { fontSize: '13px', color: c.dim, lineHeight: 1.55, marginBottom: '4px' },
  featureMock: { marginTop: 'auto', background: c.lowest, border: `1px solid ${c.borderSoft}`, borderRadius: '6px', overflow: 'hidden' },

  mockFrame: { display: 'flex', flexDirection: 'column' },
  mockChrome: { display: 'flex', alignItems: 'center', gap: '6px', padding: '8px 12px', borderBottom: `1px solid ${c.borderSoft}`, background: c.low },
  mockDot: { width: '6px', height: '6px', borderRadius: '50%', background: c.outline, display: 'inline-block' },
  mockSearch: { fontFamily: c.mono, fontSize: '10px', color: c.faint, letterSpacing: '0.06em', marginLeft: 'auto' },
  mockBody: { padding: '4px 0' },
  mockRow: { display: 'flex', alignItems: 'center', gap: '10px', padding: '6px 12px', fontFamily: c.mono, fontSize: '11px' },
  mockMethod: { width: '46px', flexShrink: 0, fontSize: '10px' },
  mockPath: { flex: 1, color: c.dim, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  mockTime: { width: '36px', textAlign: 'right', color: c.faint, fontSize: '10px', flexShrink: 0 },

  mockReplyHead: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 12px', borderBottom: `1px solid ${c.borderSoft}`, background: c.low },
  mockReplyLabel: { fontFamily: c.mono, fontSize: '10px', color: c.faint, letterSpacing: '0.22em', textTransform: 'uppercase' },
  mockPillOn: { fontFamily: c.mono, fontSize: '10px', color: c.fg, padding: '2px 8px', border: `1px solid ${c.outline}`, borderRadius: '999px', letterSpacing: '0.06em' },
  mockReplyBody: { padding: '10px 12px' },
  mockReplyField: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '4px 0', borderBottom: `1px dashed ${c.borderSoft}` },
  mockFieldLabel: { fontFamily: c.mono, fontSize: '10px', color: c.faint, letterSpacing: '0.1em', textTransform: 'uppercase' },
  mockFieldVal: { fontFamily: c.mono, fontSize: '11px', color: c.fg },
  mockReplyJson: { fontFamily: c.mono, fontSize: '11px', color: c.dim, margin: '8px 0 0', lineHeight: 1.5, whiteSpace: 'pre' },

  mockSchema: { padding: '6px 0' },
  mockSchemaRow: { display: 'flex', alignItems: 'center', gap: '10px', padding: '7px 12px', borderBottom: `1px solid ${c.borderSoft}`, fontFamily: c.mono, fontSize: '11px' },
  mockFieldName: { color: c.fg, flex: 1 },
  mockTypeTag: { padding: '2px 7px', border: `1px solid ${c.outline}`, borderRadius: '3px', fontSize: '10px', color: c.dim, letterSpacing: '0.04em' },
  mockSpark: { width: '32px', height: '10px', background: `linear-gradient(to right, ${c.accent} 0% 30%, rgba(200,255,0,0.4) 30% 100%)`, borderRadius: '1px', opacity: 0.7 },

  mockDiff: { padding: '4px 0' },
  mockDiffRow: { display: 'flex', alignItems: 'center', gap: '10px', padding: '6px 12px', borderBottom: `1px solid ${c.borderSoft}`, fontFamily: c.mono, fontSize: '11px' },
  mockDiffA: { width: '14px', height: '14px', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', borderRadius: '3px', background: c.ctr, color: c.dim, fontSize: '9px', fontWeight: 600 },
  mockDiffMethod: { width: '36px', fontSize: '10px', color: c.fg },
  mockDiffPath: { flex: 1, color: c.dim },
  mockDiffTime: { color: c.faint, fontSize: '10px' },
  mockDiffBody: { padding: '10px 12px', fontFamily: c.mono, fontSize: '11px' },
  mockDiffLine: { display: 'flex', gap: '8px', lineHeight: 1.6 },
  mockDiffMinus: { color: '#f87171', width: '8px' },
  mockDiffPlus: { color: c.accent, width: '8px' },
  mockDiffTextOld: { color: c.dim, textDecoration: 'line-through', textDecorationColor: c.faint, opacity: 0.7 },
  mockDiffTextNew: { color: c.fg },

  faq: { borderTop: `1px solid ${c.borderSoft}`, padding: '64px 24px', background: c.bg },
  faqInner: { maxWidth: '720px', margin: '0 auto', display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center' },
  faqList: { width: '100%', marginTop: '32px', textAlign: 'left', display: 'flex', flexDirection: 'column', border: `1px solid ${c.border}`, borderRadius: '8px', overflow: 'hidden' },
  faqItem: { borderBottom: `1px solid ${c.borderSoft}`, background: c.lowest, listStyle: 'none' },
  faqQ: { padding: '16px 20px', cursor: 'pointer', fontSize: '14px', color: c.fg, fontFamily: c.sans, fontWeight: 500, outline: 'none', userSelect: 'none', listStyle: 'none' },
  faqA: { padding: '0 20px 18px', fontSize: '13px', color: c.dim, lineHeight: 1.6, margin: 0 },

  finalCta: { borderTop: `1px solid ${c.borderSoft}`, padding: '80px 24px', background: c.lowest },
  finalCtaInner: { maxWidth: '720px', margin: '0 auto', display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', gap: '20px' },
  finalCtaEyebrow: { fontFamily: c.mono, fontSize: '11px', color: c.dim, letterSpacing: '0.24em', textTransform: 'uppercase', opacity: 0.85 },
  finalCtaTitle: { fontSize: 'clamp(32px, 4vw, 44px)', fontWeight: 500, color: c.fg, lineHeight: 1.1, letterSpacing: '-1.5px' },
  finalCtaTitleMono: { fontFamily: c.mono, fontSize: '0.7em', color: c.dim, letterSpacing: '-0.5px', fontWeight: 500 },
  finalCtaBtn: { padding: '14px 28px', fontSize: '15px', marginTop: '8px' },
  finalCtaLinks: { display: 'flex', alignItems: 'center', gap: '8px', marginTop: '4px' },
  finalCtaLink: { fontFamily: c.mono, fontSize: '12px', color: c.dim, textDecoration: 'none', letterSpacing: '0.04em' },
  finalCtaDot: { color: c.outline, fontFamily: c.mono, fontSize: '12px' },

  mockTease: { borderTop: `1px solid ${c.borderSoft}`, padding: '80px 24px', background: c.bg },
  mockTeaseInner: { maxWidth: '1080px', margin: '0 auto', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '48px', alignItems: 'center' },
  mockTeaseLeft: { display: 'flex', flexDirection: 'column', gap: '16px' },
  mockTeaseHead: { display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' },
  mockTeaseBlurb: { fontSize: '15px', color: c.dim, lineHeight: 1.6, maxWidth: '460px' },
  mockTeaseFooter: { fontFamily: c.mono, fontSize: '11px', color: c.faint, letterSpacing: '0.06em' },
  mockTeaseRight: { display: 'flex', justifyContent: 'flex-end' },

  chainCard: { width: '100%', maxWidth: '440px', background: c.lowest, border: `1px solid ${c.border}`, borderRadius: '8px', padding: '20px', display: 'flex', flexDirection: 'column', gap: '12px' },
  chainHead: { display: 'flex', alignItems: 'center', gap: '8px', borderBottom: `1px solid ${c.borderSoft}`, paddingBottom: '12px' },
  chainHeadText: { fontFamily: c.mono, fontSize: '10px', color: c.faint, letterSpacing: '0.22em', textTransform: 'uppercase' },
  chainList: { display: 'flex', flexDirection: 'column' },
  chainNode: { display: 'flex', gap: '14px', alignItems: 'flex-start' },
  chainConnector: { display: 'flex', flexDirection: 'column', alignItems: 'center', minWidth: '12px', paddingTop: '6px' },
  chainMarker: { width: '10px', height: '10px', borderRadius: '50%', background: c.accent, boxShadow: `0 0 0 3px ${c.green10}`, flexShrink: 0 },
  chainLine: { width: '1px', flex: 1, background: c.outline, opacity: 0.4, marginTop: '4px' },
  chainBody: { flex: 1, paddingBottom: '16px', display: 'flex', flexDirection: 'column', gap: '4px' },
  chainRow: { display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' },
  chainLabel: { fontFamily: c.mono, fontSize: '11px', color: c.fg, letterSpacing: '0.04em' },
  chainTiming: { fontFamily: c.mono, fontSize: '10px', color: c.faint, letterSpacing: '0.04em' },
  chainStatus: { fontFamily: c.mono, fontSize: '13px', color: c.fg, letterSpacing: '-0.2px' },
  chainKind: { fontFamily: c.mono, fontSize: '10px', color: c.dim, letterSpacing: '0.16em', textTransform: 'uppercase', marginTop: '4px' },
  chainKindForwarded: { color: c.accent },

  mcpSection: { borderTop: `1px solid ${c.borderSoft}`, padding: '64px 24px 80px', background: c.lowest },
  mcpInner: { maxWidth: '760px', margin: '0 auto', display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center' },
  mcpPicker: { width: '100%', maxWidth: '560px', background: c.ctr, border: `1px solid ${c.border}`, borderRadius: '8px', overflow: 'hidden', textAlign: 'left', marginTop: '32px' },
  mcpTabs: { display: 'flex', gap: '4px', padding: '10px 12px', borderBottom: `1px solid ${c.borderSoft}`, background: c.low },
  mcpPickerBody: { position: 'relative' },
  mcpPickerPre: { padding: '18px 18px', margin: 0, overflow: 'auto' },
  mcpCopyBtn: { position: 'absolute', top: '12px', right: '12px', fontFamily: c.mono, fontSize: '10px', color: c.dim, background: c.lowest, border: `1px solid ${c.outline}`, borderRadius: '999px', padding: '3px 10px', cursor: 'pointer', letterSpacing: '0.16em', textTransform: 'uppercase' },
  mcpFooter: { width: '100%', marginTop: '20px' },
  mcpFooterMono: { fontFamily: c.mono, fontSize: '11px', color: c.faint, letterSpacing: '0.06em' },

  liveStripFoot: { display: 'flex', justifyContent: 'flex-end', padding: '8px 4px 0' },
  liveStripFootMono: { fontFamily: c.mono, fontSize: '10px', color: c.faint, letterSpacing: '0.06em' },
}
