import { useEffect, useState, useRef } from 'react'
import { useParams, useLocation, useNavigate, Link } from 'react-router-dom'
import { api } from '../../lib/api.js'
import { resolveInboxUrl, resolveMcpToken } from './lib/format.js'
import { GRAIN } from './lib/tokens.js'
import { s } from './styles.js'
import InboxPage from './pages/InboxPage.jsx'
import ReplyPage from './pages/ReplyPage.jsx'
import SchemaPage from './pages/SchemaPage.jsx'
import McpPage from './pages/McpPage.jsx'
import { useBrowserNotify, useCaptureNotifications } from './lib/useBrowserNotify.js'
import './animations.css'

const TABS = [
  { id: 'inbox',  path: '',        label: 'Inbox',  icon: 'inbox'        },
  { id: 'reply',  path: '/reply',  label: 'Reply',  icon: 'reply'        },
  { id: 'schema', path: '/schema', label: 'Schema', icon: 'data_object'  },
  { id: 'mcp',    path: '/mcp',    label: 'MCP',    icon: 'terminal'     },
]

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

      <aside style={s.rail} aria-label="Inspector tabs">
        <Link to="/" className="sb-link" style={s.railLogo} aria-label="peekhook home">p</Link>
        <div style={s.railDivider} aria-hidden />
        {TABS.map(tab => {
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

      {activeTab === 'inbox' && (
        <InboxPage
          token={token}
          requests={requests}
          inboxUrl={inboxUrl}
          liveStatus={liveStatus}
          newIds={newIds}
        />
      )}
      {activeTab === 'reply' && <ReplyPage token={token} />}
      {activeTab === 'schema' && <SchemaPage token={token} />}
      {activeTab === 'mcp' && <McpPage token={token} mcpToken={mcpToken} />}
    </div>
  )
}