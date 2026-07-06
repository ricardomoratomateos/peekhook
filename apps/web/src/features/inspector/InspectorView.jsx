import { useEffect, useState, useRef } from 'react'
import { useParams, useLocation, useNavigate, Link } from 'react-router-dom'
import { api } from '../../lib/api.js'
import { resolveInboxUrl, resolveMcpToken } from './lib/format.js'
import { c, GRAIN } from './lib/tokens.js'
import { s } from './styles.js'
import MethodChip from './components/MethodChip.jsx'
import LiveBadge from './components/LiveBadge.jsx'
import RequestRow from './components/RequestRow.jsx'
import DetailPanel from './components/DetailPanel.jsx'
import DiffPanel from './components/DiffPanel.jsx'
import ResponseConfigPanel from './components/ResponseConfigPanel.jsx'
import EmptyState from './components/EmptyState.jsx'
import ConnectingState from './components/ConnectingState.jsx'
import McpTokenCard from './components/McpTokenCard.jsx'
import SchemaSparkline from './components/SchemaSparkline.jsx'
import SearchBar from './components/SearchBar.jsx'
import { useBrowserNotify, useCaptureNotifications } from './lib/useBrowserNotify.js'
import './animations.css'

export default function InspectorView({ tab: tabProp }) {
  const { token } = useParams()
  const { state } = useLocation()
  const navigate = useNavigate()
  const activeTab = tabProp || 'inbox'
  const inboxUrl = resolveInboxUrl(token, state)
  const mcpToken = resolveMcpToken(token, state)
  const notify = useBrowserNotify()
  useCaptureNotifications(notify.permission === 'granted')

  const [requests, setRequests] = useState([])
  const [searchResults, setSearchResults] = useState(null)
  const [selectedId, setSelectedId] = useState(null)
  const [compareIds, setCompareIds] = useState([])
  const [showDiff, setShowDiff] = useState(false)
  const [copied, setCopied] = useState(false)
  const [copiedTest, setCopiedTest] = useState(false)
  const [liveStatus, setLiveStatus] = useState('connecting')
  const [notFound, setNotFound] = useState(false)
  const [newIds, setNewIds] = useState(new Set())
  const newIdsRef = useRef(new Set())

  const displayedRequests = searchResults ?? requests

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
        if (typeof window !== 'undefined') window.__peekhookEventSource = es
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
      if (es) {
        es.close()
        if (typeof window !== 'undefined' && window.__peekhookEventSource === es) {
          window.__peekhookEventSource = null
        }
        es = null
      }
      clearInterval(pollTimer)
    }
  }, [token])

  useEffect(() => {
    if (selectedId == null && displayedRequests.length > 0) setSelectedId(displayedRequests[0].id)
  }, [displayedRequests, selectedId])

  useEffect(() => {
    setCompareIds(prev => prev.filter(id => requests.some(r => r.id === id)).slice(0, 2))
  }, [requests])

  const selectedReq = displayedRequests.find(r => r.id === selectedId) || null

  function handleToggleCompare(req) {
    if (!req?.id) return
    setCompareIds(prev => {
      if (prev.includes(req.id)) {
        return prev.filter(id => id !== req.id)
      }
      if (prev.length < 2) return [...prev, req.id]
      return [prev[1], req.id]
    })
  }

  function handleClearCompare() {
    setCompareIds([])
    setShowDiff(false)
  }

  async function handleCopy() {
    try { await navigator.clipboard.writeText(inboxUrl) } catch (_) {}
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  async function handleCopyTestRequest() {
    try { await navigator.clipboard.writeText(buildTestCurlFull(inboxUrl)) } catch (_) {}
    setCopiedTest(true)
    setTimeout(() => setCopiedTest(false), 1800)
  }

  if (notFound) {
    return (
      <div style={s.notFound}>
        <div style={{ ...s.grain, backgroundImage: `url("${GRAIN}")` }} aria-hidden />
        <div style={s.notFoundInner}>
          <div style={s.notFoundCode}>404</div>
          <p style={s.notFoundTitle}>inbox not found</p>
          <p style={s.notFoundSub}>this inbox has expired or never existed. inboxes expire after 7 days.</p>
          <Link to="/" style={s.notFoundBtn}>get a new inbox url</Link>
        </div>
      </div>
    )
  }

  const compareReady = compareIds.length === 2
  const compareReqs = compareIds.map(id => requests.find(r => r.id === id)).filter(Boolean)
  const [compareA, compareB] = compareReqs

  return (
    <div style={s.shell}>
      <div style={{ ...s.grain, backgroundImage: `url("${GRAIN}")` }} aria-hidden />

      <aside style={s.rail} aria-label="Inspector tabs">
        <Link to="/" className="sb-link" style={s.railLogo} aria-label="peekhook home">p</Link>
        <div style={s.railDivider} aria-hidden />
        {[
          { id: 'inbox',  path: '',        label: 'Inbox',  icon: 'inbox'        },
          { id: 'reply',  path: '/reply',  label: 'Reply',  icon: 'reply'        },
          { id: 'schema', path: '/schema', label: 'Schema', icon: 'data_object'  },
          { id: 'mcp',    path: '/mcp',    label: 'MCP',    icon: 'terminal'     },
        ].map(tab => {
          const active = activeTab === tab.id
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => navigate(`/i/${token}${tab.path}`)}
              className="sb-railbtn"
              style={active ? { ...s.railBtn, ...s.railBtnActive } : s.railBtn}
              aria-label={tab.label}
              aria-pressed={active}
              title={tab.label}
            >
              <span className="material-symbols-outlined" style={{ fontSize: '18px', lineHeight: 1 }}>
                {tab.icon}
              </span>
              {active && <span style={s.railBtnDot} aria-hidden />}
            </button>
          )
        })}
      </aside>

      <aside style={s.sidebar} aria-label="Sandbox inbox">
        {activeTab === 'inbox' && (
          <InboxTab
            inboxUrl={inboxUrl}
            liveStatus={liveStatus}
            copied={copied}
            copiedTest={copiedTest}
            onCopy={handleCopy}
            onCopyTest={handleCopyTestRequest}
            token={token}
            searchResults={searchResults}
            setSearchResults={setSearchResults}
            requests={requests}
            displayedRequests={displayedRequests}
            selectedId={selectedId}
            setSelectedId={setSelectedId}
            compareIds={compareIds}
            compareReady={compareReady}
            newIds={newIds}
            handleToggleCompare={handleToggleCompare}
            handleClearCompare={handleClearCompare}
            setShowDiff={setShowDiff}
          />
        )}
        {activeTab === 'reply' && (
          <ConfigTab title="Reply" hint="mock response on capture">
            <ResponseConfigPanel token={token} />
          </ConfigTab>
        )}
        {activeTab === 'schema' && (
          <ConfigTab title="Schema" hint="field shape across captures">
            <SchemaSparkline token={token} />
          </ConfigTab>
        )}
        {activeTab === 'mcp' && (
          <ConfigTab title="MCP" hint="give an agent inbox access">
            <div style={{ flexShrink: 0 }}>
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
            </div>
            <McpTokenCard mcpToken={mcpToken} inboxToken={token} />
          </ConfigTab>
        )}
      </aside>

      <main style={s.content} aria-label={showDiff ? 'Request diff' : 'Request detail'}>
        {showDiff && compareA && compareB
          ? <DiffPanel a={compareA} b={compareB} token={token} onBack={() => setShowDiff(false)} onClear={handleClearCompare} />
          : requests.length === 0
            ? (liveStatus === 'connecting' ? <ConnectingState /> : <EmptyState inboxUrl={inboxUrl} onCopy={handleCopyTestRequest} token={token} />)
            : <DetailPanel req={selectedReq} token={token} />}
      </main>
    </div>
  )
}

function ConfigTab({ title, hint, children }) {
  return (
    <>
      <div style={s.sidebarTabMeta}>
        <span style={s.sidebarTabTitle}>{title}</span>
        <span style={s.sidebarTabHint}>{hint}</span>
      </div>
      <div style={s.sidebarScroll}>{children}</div>
    </>
  )
}

function InboxTab({
  inboxUrl,
  liveStatus,
  copied,
  copiedTest,
  onCopy,
  onCopyTest,
  token,
  searchResults,
  setSearchResults,
  requests,
  displayedRequests,
  selectedId,
  setSelectedId,
  compareIds,
  compareReady,
  newIds,
  handleToggleCompare,
  handleClearCompare,
  setShowDiff,
}) {
  const [searchOpen, setSearchOpen] = useState(false)
  return (
    <>
      <div style={s.ctxRow}>
        <span className="material-symbols-outlined" style={s.ctxIcon}>inbox</span>
        <span style={s.ctxName}>inbox</span>
        <LiveBadge status={liveStatus} />
      </div>

      <div style={s.urlCard}>
        <span style={s.urlText} title={inboxUrl}>{inboxUrl}</span>
        <button onClick={onCopy} className="sb-copy" style={s.copyBtn} aria-label={copied ? 'Copied' : 'Copy inbox URL'}>
          <span className="material-symbols-outlined" style={{ fontSize: '14px' }}>{copied ? 'check' : 'content_copy'}</span>
        </button>
      </div>

      <button
        type="button"
        onClick={onCopyTest}
        className="sb-copytest"
        style={s.copyTestBtn}
        aria-label={copiedTest ? 'Copied test request' : 'Copy a test request'}
      >
        <span className="material-symbols-outlined" style={{ fontSize: '14px' }}>
          {copiedTest ? 'check' : 'terminal'}
        </span>
        <span style={{ flex: 1 }}>{copiedTest ? 'copied' : 'copy a test request'}</span>
      </button>

      {searchOpen && (
        <div style={searchBoxStyle}>
          <SearchBar
            token={token}
            onResults={setSearchResults}
            onClear={() => setSearchResults(null)}
          />
        </div>
      )}

      <div style={s.listHead}>
        <span style={s.listHeadLabel}>
          {searchResults ? 'search results' : 'requests'}
        </span>
        {displayedRequests.length > 0 && (
          <span style={s.listHeadCount}>{displayedRequests.length}</span>
        )}
        <button
          type="button"
          onClick={() => setSearchOpen(o => !o)}
          className="sb-searchtoggle"
          style={searchToggleBtn}
          aria-label={searchOpen ? 'close search' : 'open search'}
          aria-expanded={searchOpen}
          title="search (regex or natural language)"
        >
          <span className="material-symbols-outlined" style={{ fontSize: '14px', lineHeight: 1 }}>
            {searchOpen ? 'close' : 'search'}
          </span>
        </button>
      </div>

      {compareIds.length > 0 && (
        <div style={compareBarStyle}>
          <div style={compareBarTitle}>
            compare {compareIds.length}/2
          </div>
          <div style={compareBarPicks}>
            {compareIds.map((id, idx) => {
              const r = requests.find(x => x.id === id)
              return (
                <span key={id} style={comparePill}>
                  <span style={{ ...compareDot, background: idx === 0 ? '#ef4444' : '#22c55e' }} aria-hidden />
                  <span style={comparePillMethod}>{r ? (r.method || '?').toLowerCase() : '?'}</span>
                  <span style={comparePillPath}>{r ? prettyPath(r.path, token) : '…'}</span>
                  <button
                    type="button"
                    onClick={() => handleToggleCompare({ id })}
                    aria-label="remove from compare"
                    style={comparePillClose}
                  >
                    <span className="material-symbols-outlined" style={{ fontSize: '12px', lineHeight: 1 }}>close</span>
                  </button>
                </span>
              )
            })}
          </div>
          <div style={compareBarActions}>
            <button
              type="button"
              onClick={handleClearCompare}
              style={compareGhostBtn}
            >
              clear
            </button>
            <button
              type="button"
              disabled={!compareReady}
              onClick={() => setShowDiff(true)}
              style={compareReady ? comparePrimaryBtn : compareDisabledBtn}
              aria-label={compareReady ? 'show diff' : 'pick two requests'}
            >
              show diff
            </button>
          </div>
        </div>
      )}

      <div style={s.listRows}>
        {displayedRequests.length === 0 ? (
          <div style={s.listEmpty}>
            <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: c.accent, animation: 'sbpulse 2s ease infinite' }} />
            <span style={s.listEmptyText}>
              {searchResults ? 'no matches' : 'waiting for first request…'}
            </span>
          </div>
        ) : (
          displayedRequests.map(req => (
            <RequestRow
              key={req.id}
              req={req}
              token={token}
              selected={req.id === selectedId}
              isNew={!searchResults && newIds.has(req.id)}
              compareSelected={compareIds.includes(req.id)}
              onClick={() => setSelectedId(req.id === selectedId ? null : req.id)}
              onToggleCompare={handleToggleCompare}
            />
          ))
        )}
      </div>
    </>
  )
}

function prettyPath(path, token) {
  if (!path) return '/'
  const t = '/' + token
  if (path.startsWith(t)) return path.slice(t.length) || '/'
  return path
}

const compareBarStyle = {
  margin: '0 8px 8px', padding: '10px 10px 10px',
  border: `1px solid ${c.border}`, borderRadius: '8px',
  background: c.bg, flexShrink: 0,
  display: 'flex', flexDirection: 'column', gap: '8px',
}

const compareBarTitle = {
  fontFamily: c.mono, fontSize: '10px', color: c.faint,
  letterSpacing: '0.16em', textTransform: 'uppercase',
}

const compareBarPicks = { display: 'flex', flexDirection: 'column', gap: '4px' }

const comparePill = {
  display: 'flex', alignItems: 'center', gap: '6px',
  padding: '4px 6px', borderRadius: '4px',
  background: c.lowest, border: `1px solid ${c.borderSoft}`,
  fontFamily: c.mono, fontSize: '11px', color: c.dim,
  minWidth: 0,
}

const compareDot = {
  width: '6px', height: '6px', borderRadius: '50%', flexShrink: 0,
}

const comparePillMethod = {
  color: c.faint, textTransform: 'uppercase',
  flexShrink: 0,
}

const comparePillPath = {
  flex: 1, overflow: 'hidden', textOverflow: 'ellipsis',
  whiteSpace: 'nowrap', minWidth: 0,
}

const comparePillClose = {
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
  background: 'transparent', border: 'none', color: c.faint,
  cursor: 'pointer', padding: 0, flexShrink: 0,
}

const compareBarActions = { display: 'flex', gap: '6px' }

const compareGhostBtn = {
  flex: 1, background: 'transparent',
  border: `1px solid ${c.border}`, borderRadius: '4px',
  padding: '6px 8px', fontFamily: c.sans, fontSize: '11px',
  color: c.dim, cursor: 'pointer',
}

const comparePrimaryBtn = {
  flex: 1, background: c.accent, color: c.accentInk,
  border: 'none', borderRadius: '4px',
  padding: '6px 8px', fontFamily: c.sans, fontSize: '11px',
  fontWeight: 500, cursor: 'pointer',
}

const compareDisabledBtn = {
  ...comparePrimaryBtn,
  background: c.ctr, color: c.faint, cursor: 'not-allowed',
}

function buildTestCurlFull(inboxUrl) {
  return `curl -s -X POST ${inboxUrl || '<your-inbox-url>'} \\
  -H "content-type: application/json" \\
  -w "\\nHTTP %{http_code}\\n" \\
  -d '{"event":"test","hello":"world"}'`
}