import { useState, useEffect } from 'react'
import { c } from '../lib/tokens.js'
import { s, d } from '../styles.js'
import RequestRow from '../components/RequestRow.jsx'
import DetailPanel from '../components/DetailPanel.jsx'
import DiffPanel from '../components/DiffPanel.jsx'
import EmptyState from '../components/EmptyState.jsx'
import ConnectingState from '../components/ConnectingState.jsx'
import LiveBadge from '../components/LiveBadge.jsx'
import SearchBar from '../components/SearchBar.jsx'
import { buildTestCurl, prettyPath } from '../lib/format.js'

export default function InboxPage({
  token,
  requests,
  inboxUrl,
  liveStatus,
  newIds,
}) {
  const [selectedId, setSelectedId] = useState(null)
  const [compareIds, setCompareIds] = useState([])
  const [showDiff, setShowDiff] = useState(false)
  const [searchResults, setSearchResults] = useState(null)
  const [copied, setCopied] = useState(false)
  const [copiedTest, setCopiedTest] = useState(false)

  const displayedRequests = searchResults ?? requests

  useEffect(() => {
    if (selectedId == null && displayedRequests.length > 0) {
      setSelectedId(displayedRequests[0].id)
    }
  }, [displayedRequests, selectedId])

  useEffect(() => {
    setCompareIds(prev => prev.filter(id => requests.some(r => r.id === id)).slice(0, 2))
  }, [requests])

  async function handleCopy() {
    try { await navigator.clipboard.writeText(inboxUrl) } catch (_) {}
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  async function handleCopyTest() {
    try { await navigator.clipboard.writeText(buildTestCurl(inboxUrl)) } catch (_) {}
    setCopiedTest(true)
    setTimeout(() => setCopiedTest(false), 1800)
  }

  function handleToggleCompare(req) {
    if (!req?.id) return
    setCompareIds(prev => {
      if (prev.includes(req.id)) return prev.filter(id => id !== req.id)
      if (prev.length < 2) return [...prev, req.id]
      return [prev[1], req.id]
    })
  }

  function handleClearCompare() {
    setCompareIds([])
    setShowDiff(false)
  }

  const compareReqs = compareIds
    .map(id => requests.find(r => r.id === id))
    .filter(Boolean)
  const [compareA, compareB] = compareReqs
  const compareReady = compareIds.length === 2
  const selectedReq = displayedRequests.find(r => r.id === selectedId) || null

  return (
    <div style={s.page}>
      <header style={s.pageHeader}>
        <div style={d.eyebrow}>sandbox · inbox</div>
        <div style={s.pageHeaderRow}>
          <div style={d.headlineRow}>
            <span style={d.methodLg}>inbox</span>
            <span style={d.pathLg}>/ live</span>
            <LiveBadge status={liveStatus} />
          </div>
          <div style={s.pageHeaderRight}>
            <div style={s.urlCard}>
              <span style={s.urlText} title={inboxUrl}>{inboxUrl}</span>
              <button onClick={handleCopy} className="sb-copy" style={s.copyBtn} aria-label={copied ? 'Copied' : 'Copy inbox URL'}>
                <span className="material-symbols-outlined" style={{ fontSize: '14px' }}>
                  {copied ? 'check' : 'content_copy'}
                </span>
              </button>
            </div>
            <button
              type="button"
              onClick={handleCopyTest}
              className="sb-copytest"
              style={s.copyTestBtn}
              aria-label={copiedTest ? 'Copied test request' : 'Copy a test request'}
            >
              <span className="material-symbols-outlined" style={{ fontSize: '14px' }}>
                {copiedTest ? 'check' : 'terminal'}
              </span>
              <span>{copiedTest ? 'copied' : 'copy a test request'}</span>
            </button>
          </div>
        </div>
      </header>

      <div style={masterDetail}>
        <aside style={s.masterPane} aria-label="Request list">
          <div style={s.searchBox}>
            <SearchBar
              token={token}
              onResults={setSearchResults}
              onClear={() => setSearchResults(null)}
            />
          </div>

          <div style={s.listHead}>
            <span style={s.listHeadLabel}>
              {searchResults ? 'search results' : 'requests'}
            </span>
            {displayedRequests.length > 0 && (
              <span style={s.listHeadCount}>{displayedRequests.length}</span>
            )}
          </div>

          {compareIds.length > 0 && (
            <div style={compareBarStyle}>
              <div style={compareBarTitle}>compare {compareIds.length}/2</div>
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
                <button type="button" onClick={handleClearCompare} style={compareGhostBtn}>
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
        </aside>

        <main style={s.detailPane} aria-label={showDiff ? 'Request diff' : 'Request detail'}>
          {showDiff && compareA && compareB
            ? <DiffPanel a={compareA} b={compareB} token={token} onBack={() => setShowDiff(false)} onClear={handleClearCompare} />
            : requests.length === 0
              ? (liveStatus === 'connecting' ? <ConnectingState /> : <EmptyState inboxUrl={inboxUrl} onCopy={handleCopyTest} token={token} />)
              : <DetailPanel req={selectedReq} token={token} />}
        </main>
      </div>
    </div>
  )
}

const masterDetail = {
  flex: 1, display: 'flex', minHeight: 0, overflow: 'hidden',
}

const compareBarStyle = {
  margin: '0 12px 10px', padding: '10px',
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