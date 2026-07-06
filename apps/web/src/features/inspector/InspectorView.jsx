import { useEffect, useState, useRef } from 'react'
import { useParams, useLocation, Link } from 'react-router-dom'
import { api } from '../../lib/api.js'
import { resolveInboxUrl, resolveMcpToken } from './lib/format.js'
import { c, GRAIN } from './lib/tokens.js'
import { s } from './styles.js'
import MethodChip from './components/MethodChip.jsx'
import LiveBadge from './components/LiveBadge.jsx'
import RequestRow from './components/RequestRow.jsx'
import DetailPanel from './components/DetailPanel.jsx'
import ResponseConfigPanel from './components/ResponseConfigPanel.jsx'
import EmptyState from './components/EmptyState.jsx'
import ConnectingState from './components/ConnectingState.jsx'
import McpTokenCard from './components/McpTokenCard.jsx'
import SchemaSparkline from './components/SchemaSparkline.jsx'
import './animations.css'

export default function InspectorView() {
  const { token } = useParams()
  const { state } = useLocation()
  const inboxUrl = resolveInboxUrl(token, state)
  const mcpToken = resolveMcpToken(token, state)

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

  return (
    <div style={s.shell}>
      <div style={{ ...s.grain, backgroundImage: `url("${GRAIN}")` }} aria-hidden />

      <aside style={s.sidebar} aria-label="Sandbox inbox">
        <div style={s.logo}>
          <Link to="/" className="sb-link" style={s.logoText}>peekhook</Link>
        </div>

        <div style={s.ctxRow}>
          <span className="material-symbols-outlined" style={s.ctxIcon}>science</span>
          <span style={s.ctxName}>inbox</span>
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

        <McpTokenCard mcpToken={mcpToken} inboxToken={token} />

        <SchemaSparkline token={token} />

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

      <main style={s.content} aria-label="Request detail">
        {requests.length === 0
          ? (liveStatus === 'connecting' ? <ConnectingState /> : <EmptyState inboxUrl={inboxUrl} onCopy={handleCopyTestRequest} />)
          : <DetailPanel req={selectedReq} token={token} />}
      </main>
    </div>
  )
}

function buildTestCurlFull(inboxUrl) {
  return `curl -s -X POST ${inboxUrl || '<your-inbox-url>'} \\
  -H "content-type: application/json" \\
  -w "\\nHTTP %{http_code}\\n" \\
  -d '{"event":"test","hello":"world"}'`
}
