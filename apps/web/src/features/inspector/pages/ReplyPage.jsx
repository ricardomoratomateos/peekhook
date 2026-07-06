import { useState, useEffect, useCallback } from 'react'
import ResponseConfigPanel from '../components/ResponseConfigPanel.jsx'
import ForwardConfigPanel from '../components/ForwardConfigPanel.jsx'
import ConfirmModal from '../components/ConfirmModal.jsx'
import { api } from '../../../lib/api.js'
import { s, d } from '../styles.js'

export default function ReplyPage({ token }) {
  const [inbox, setInbox] = useState(null)
  const [loadError, setLoadError] = useState(null)
  const [pendingClear, setPendingClear] = useState(null)
  const [busy, setBusy] = useState(false)

  const refresh = useCallback(async () => {
    try {
      const d = await api.getInbox(token)
      setInbox(d)
      setLoadError(null)
    } catch (err) {
      setLoadError(err.message)
    }
  }, [token])

  useEffect(() => {
    let cancelled = false
    refresh()
    return () => { cancelled = true }
  }, [refresh])

  const responseConfig = inbox?.responseConfig ?? null
  const forwardTo      = inbox?.forwardTo      ?? null
  const ingestUrl      = inbox?.ingestUrl      ?? null

  async function commitInbox({ response, forwardTo: nextForward }) {
    setBusy(true)
    setLoadError(null)
    try {
      if (response === null) {
        await api.clearResponse(token)
      } else if (response) {
        await api.setResponse(token, response)
      }
      if (nextForward === null) {
        await api.clearForward(token)
      } else if (typeof nextForward === 'string') {
        await api.setForward(token, nextForward)
      }
      await refresh()
    } catch (err) {
      setLoadError(err.message)
    } finally {
      setBusy(false)
    }
  }

  async function clearBoth({ keep }) {
    setBusy(true)
    setLoadError(null)
    setPendingClear(null)
    try {
      if (keep === 'forward') {
        await api.clearResponse(token)
      } else if (keep === 'response') {
        await api.clearForward(token)
      }
      await refresh()
    } catch (err) {
      setLoadError(err.message)
    } finally {
      setBusy(false)
    }
  }

  function handleRequestSaveResponse(config) {
    const hasForward = Boolean(forwardTo)
    if (hasForward && config && config.enabled) {
      setPendingClear({
        kind: 'response-overwrites-forward',
        config,
      })
      return
    }
    commitInbox({ response: config })
  }

  function handleRequestClearResponse() {
    const hasForward = Boolean(forwardTo)
    if (hasForward) {
      setPendingClear({
        kind: 'response-clear-while-forward-set',
      })
      return
    }
    commitInbox({ response: null })
  }

  function handleRequestSaveForward(url) {
    const hasResponse = Boolean(responseConfig?.enabled)
    if (hasResponse) {
      setPendingClear({
        kind: 'forward-overwrites-response',
        url,
      })
      return
    }
    commitInbox({ forwardTo: url })
  }

  function handleRequestClearForward() {
    commitInbox({ forwardTo: null })
  }

  function confirmPending() {
    if (!pendingClear) return
    if (pendingClear.kind === 'response-overwrites-forward') {
      commitInbox({ response: pendingClear.config, forwardTo: null })
    } else if (pendingClear.kind === 'response-clear-while-forward-set') {
      commitInbox({ response: null })
    } else if (pendingClear.kind === 'forward-overwrites-response') {
      commitInbox({ forwardTo: pendingClear.url, response: null })
    }
    setPendingClear(null)
  }

  if (loadError && !inbox) {
    return (
      <div style={s.page}>
        <header style={s.pageHeader}>
          <div style={d.eyebrow}>sandbox · reply</div>
          <div style={d.headlineRow}>
            <span style={d.methodLg}>reply</span>
            <span style={d.pathLg}>/ config</span>
          </div>
        </header>
        <div style={s.pageBody}>
          <div style={{ color: 'var(--status-red)', fontFamily: 'var(--font-mono)', fontSize: '12px' }}>
            {loadError}
          </div>
        </div>
      </div>
    )
  }

  if (!inbox) {
    return (
      <div style={s.page}>
        <header style={s.pageHeader}>
          <div style={d.eyebrow}>sandbox · reply</div>
        </header>
        <div style={s.pageBody}>
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: '12px', color: 'var(--text-muted)' }}>
            loading…
          </span>
        </div>
      </div>
    )
  }

  const modalConfig = pendingClear ? describeModal(pendingClear) : null

  return (
    <div style={s.page}>
      <header style={s.pageHeader}>
        <div style={d.eyebrow}>sandbox · reply</div>
        <div style={d.headlineRow}>
          <span style={d.methodLg}>reply</span>
          <span style={d.pathLg}>/ config</span>
        </div>
      </header>
      <div style={{ ...s.pageBody, gap: '40px' }}>
        <ResponseConfigPanel
          token={token}
          value={responseConfig}
          onRequestSave={handleRequestSaveResponse}
          onRequestClear={handleRequestClearResponse}
          busy={busy}
        />
        <ForwardConfigPanel
          token={token}
          value={forwardTo}
          onRequestSave={handleRequestSaveForward}
          onRequestClear={handleRequestClearForward}
          busy={busy}
          ingestUrl={ingestUrl}
        />
      </div>
      {modalConfig && (
        <ConfirmModal
          title={modalConfig.title}
          body={modalConfig.body}
          monoBlock={modalConfig.monoBlock}
          confirmLabel={modalConfig.confirmLabel}
          cancelLabel={modalConfig.cancelLabel}
          onConfirm={confirmPending}
          onCancel={() => setPendingClear(null)}
        />
      )}
    </div>
  )
}

function describeModal(pending) {
  switch (pending.kind) {
    case 'response-overwrites-forward':
      return {
        title: 'overwrite current forward?',
        body: (
          <>
            enabling a custom reply will remove the forward target set on this inbox.
            incoming webhooks will return the custom reply below instead of being proxied.
          </>
        ),
        confirmLabel: 'yes, use custom reply',
        cancelLabel: 'keep forward',
      }
    case 'response-clear-while-forward-set':
      return {
        title: 'forward is also configured',
        body: (
          <>
            this inbox has a forward target configured. clearing the custom reply
            will leave the forward intact — webhooks will still be proxied after clearing.
            continue?
          </>
        ),
        confirmLabel: 'yes, clear reply',
        cancelLabel: 'keep reply',
      }
    case 'forward-overwrites-response':
      return {
        title: 'overwrite existing custom reply?',
        body: (
          <>
            this inbox has a custom reply configured. setting forwardTo will
            remove that custom reply and forward incoming webhooks to the url below.
            the custom reply will be lost.
          </>
        ),
        monoBlock: pending.url,
        confirmLabel: 'yes, use forward',
        cancelLabel: 'keep custom reply',
      }
    default:
      return null
  }
}
