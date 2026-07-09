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
import ConfirmModal from '../components/ConfirmModal.jsx'
import { buildTestCurl, prettyPath } from '../lib/format.js'
import { api } from '../../../lib/api.js'

export default function InboxPage({
  token,
  requests,
  inboxUrl,
  liveStatus,
  newIds,
  onCleared,
  onRemoved,
}) {
  const [selectedId, setSelectedId] = useState(null)
  const [checkedIds, setCheckedIds] = useState([])
  const [showDiff, setShowDiff] = useState(false)
  const [searchResults, setSearchResults] = useState(null)
  const [copied, setCopied] = useState(false)
  const [copiedTest, setCopiedTest] = useState(false)
  const [confirm, setConfirm] = useState(null)   // 'clearAll' | 'deleteSelected' | null
  const [busy, setBusy] = useState(false)

  const displayedRequests = searchResults ?? requests

  useEffect(() => {
    if (selectedId == null && displayedRequests.length > 0) {
      setSelectedId(displayedRequests[0].id)
    }
  }, [displayedRequests, selectedId])

  // Prune the checked set to ids that still exist.
  useEffect(() => {
    setCheckedIds(prev => prev.filter(id => requests.some(r => r.id === id)))
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

  function toggleCheck(req) {
    if (!req?.id) return
    setCheckedIds(prev => prev.includes(req.id) ? prev.filter(id => id !== req.id) : [...prev, req.id])
  }

  const allChecked = displayedRequests.length > 0 && displayedRequests.every(r => checkedIds.includes(r.id))

  function toggleSelectAll() {
    if (allChecked) {
      setCheckedIds([])
    } else {
      setCheckedIds(displayedRequests.map(r => r.id))
    }
  }

  function clearSelection() {
    setCheckedIds([])
    setShowDiff(false)
  }

  function exportEvents(ids) {
    const a = document.createElement('a')
    a.href = api.exportUrl(token, ids)
    a.download = `peekhook-${token}-export.json`
    document.body.appendChild(a)
    a.click()
    a.remove()
  }

  async function doClearAll() {
    setBusy(true)
    try {
      await api.clearRequests(token)
      setSelectedId(null)
      clearSelection()
      setSearchResults(null)
      onCleared?.()
    } catch (_) { /* leave list as-is on failure */ }
    setBusy(false)
    setConfirm(null)
  }

  async function doDeleteSelected() {
    const ids = [...checkedIds]
    setBusy(true)
    try {
      await api.clearRequests(token, ids)
      if (ids.includes(selectedId)) setSelectedId(null)
      clearSelection()
      onRemoved?.(ids)
    } catch (_) { /* leave list as-is on failure */ }
    setBusy(false)
    setConfirm(null)
  }

  const checkedReqs = checkedIds.map(id => requests.find(r => r.id === id)).filter(Boolean)
  const [compareA, compareB] = checkedReqs
  const compareReady = checkedIds.length === 2
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
            {displayedRequests.length > 0 && (
              <button
                type="button"
                onClick={toggleSelectAll}
                className="sb-listaction"
                style={selectAllBtn}
                title={allChecked ? 'Deselect all' : 'Select all'}
                aria-label={allChecked ? 'Deselect all' : 'Select all'}
                aria-pressed={allChecked}
              >
                <span className="material-symbols-outlined" style={{ fontSize: '16px', lineHeight: 1, color: allChecked ? c.accent : c.faint }}>
                  {allChecked ? 'check_box' : 'check_box_outline_blank'}
                </span>
              </button>
            )}
            <span style={s.listHeadLabel}>
              {searchResults ? 'search results' : 'requests'}
            </span>
            {displayedRequests.length > 0 && (
              <span style={s.listHeadCount}>{displayedRequests.length}</span>
            )}
            {requests.length > 0 && checkedIds.length === 0 && !searchResults && (
              <span style={listHeadActions}>
                <button
                  type="button"
                  onClick={() => exportEvents(null)}
                  className="sb-listaction"
                  style={listActionBtn}
                  title="Download all captures as JSON"
                  aria-label="Export all captures as JSON"
                >
                  <span className="material-symbols-outlined" style={{ fontSize: '14px', lineHeight: 1 }}>download</span>
                </button>
                <button
                  type="button"
                  onClick={() => setConfirm('clearAll')}
                  className="sb-listaction"
                  style={listActionBtn}
                  title="Clear all captures (keeps the inbox URL)"
                  aria-label="Clear all captures"
                >
                  <span className="material-symbols-outlined" style={{ fontSize: '14px', lineHeight: 1 }}>delete_sweep</span>
                </button>
              </span>
            )}
          </div>

          {checkedIds.length > 0 && (
            <div style={selectionBarStyle}>
              <div style={selectionBarTop}>
                <span style={selectionBarTitle}>{checkedIds.length} selected</span>
                <button type="button" onClick={clearSelection} style={selGhostBtn}>clear</button>
              </div>
              <div style={selectionBarActions}>
                <button
                  type="button"
                  onClick={() => exportEvents(checkedIds)}
                  style={selActionBtn}
                  aria-label="Export selected captures"
                >
                  <span className="material-symbols-outlined" style={selActionIcon}>download</span>
                  export
                </button>
                <button
                  type="button"
                  onClick={() => setConfirm('deleteSelected')}
                  style={{ ...selActionBtn, color: 'var(--status-red)' }}
                  aria-label="Delete selected captures"
                >
                  <span className="material-symbols-outlined" style={selActionIcon}>delete</span>
                  delete
                </button>
                <button
                  type="button"
                  disabled={!compareReady}
                  onClick={() => setShowDiff(true)}
                  style={compareReady ? selActionBtn : { ...selActionBtn, opacity: 0.45, cursor: 'not-allowed' }}
                  title={compareReady ? 'Diff the two selected' : 'Select exactly two to diff'}
                  aria-label="Diff the two selected"
                >
                  <span className="material-symbols-outlined" style={selActionIcon}>difference</span>
                  diff
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
                  checked={checkedIds.includes(req.id)}
                  onClick={() => setSelectedId(req.id === selectedId ? null : req.id)}
                  onToggleSelect={toggleCheck}
                />
              ))
            )}
          </div>
        </aside>

        <main style={s.detailPane} aria-label={showDiff ? 'Request diff' : 'Request detail'}>
          {showDiff && compareA && compareB
            ? <DiffPanel a={compareA} b={compareB} token={token} onBack={() => setShowDiff(false)} onClear={clearSelection} />
            : requests.length === 0
              ? (liveStatus === 'connecting' ? <ConnectingState /> : <EmptyState inboxUrl={inboxUrl} onCopy={handleCopyTest} token={token} />)
              : <DetailPanel req={selectedReq} token={token} />}
        </main>
      </div>

      {confirm === 'clearAll' && (
        <ConfirmModal
          title="clear all captures?"
          body={`This permanently deletes all ${requests.length} captured request${requests.length === 1 ? '' : 's'} in this inbox and resets its capture limit. The inbox URL keeps working.`}
          confirmLabel={busy ? 'clearing…' : 'clear captures'}
          cancelLabel="cancel"
          onConfirm={doClearAll}
          onCancel={() => setConfirm(null)}
        />
      )}
      {confirm === 'deleteSelected' && (
        <ConfirmModal
          title={`delete ${checkedIds.length} capture${checkedIds.length === 1 ? '' : 's'}?`}
          body={`This permanently deletes the ${checkedIds.length} selected request${checkedIds.length === 1 ? '' : 's'}. The rest of the inbox is untouched.`}
          confirmLabel={busy ? 'deleting…' : 'delete selected'}
          cancelLabel="cancel"
          onConfirm={doDeleteSelected}
          onCancel={() => setConfirm(null)}
        />
      )}
    </div>
  )
}

const masterDetail = {
  flex: 1, display: 'flex', minHeight: 0, overflow: 'hidden',
}

const listHeadActions = {
  display: 'inline-flex', alignItems: 'center', gap: '4px', marginLeft: 'auto',
}

const listActionBtn = {
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
  background: 'transparent', border: `1px solid ${c.border}`, borderRadius: '4px',
  padding: '3px 5px', color: c.faint, cursor: 'pointer',
}

const selectAllBtn = {
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
  background: 'transparent', border: 'none', padding: 0, marginRight: '2px',
  cursor: 'pointer',
}

const selectionBarStyle = {
  margin: '0 12px 10px', padding: '10px',
  border: `1px solid ${c.border}`, borderRadius: '8px',
  background: c.bg, flexShrink: 0,
  display: 'flex', flexDirection: 'column', gap: '8px',
}

const selectionBarTop = {
  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
}

const selectionBarTitle = {
  fontFamily: c.mono, fontSize: '10px', color: c.faint,
  letterSpacing: '0.16em', textTransform: 'uppercase',
}

const selectionBarActions = { display: 'flex', gap: '6px' }

const selActionBtn = {
  flex: 1, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: '4px',
  background: 'transparent', border: `1px solid ${c.border}`, borderRadius: '4px',
  padding: '6px 8px', fontFamily: c.mono, fontSize: '11px', color: c.dim, cursor: 'pointer',
  letterSpacing: '0.03em',
}

const selActionIcon = { fontSize: '14px', lineHeight: 1 }

const selGhostBtn = {
  background: 'transparent', border: 'none', color: c.faint,
  fontFamily: c.mono, fontSize: '11px', cursor: 'pointer', padding: 0,
}
