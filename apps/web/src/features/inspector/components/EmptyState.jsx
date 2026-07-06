import { useState, useEffect } from 'react'
import { c } from '../lib/tokens.js'
import { buildTestCurl } from '../lib/format.js'
import { api } from '../../../lib/api.js'
import { d } from '../styles.js'

export default function EmptyState({ inboxUrl, onCopy, token }) {
  const curl = buildTestCurl(inboxUrl)
  const [fixtures, setFixtures] = useState([])
  const [sendingId, setSendingId] = useState(null)
  const [error, setError] = useState(null)

  useEffect(() => {
    let cancelled = false
    api.listFixtures()
      .then((list) => { if (!cancelled) setFixtures(list) })
      .catch(() => { if (!cancelled) setFixtures([]) })
    return () => { cancelled = true }
  }, [])

  async function handleSendFixture(fx) {
    if (!token) return
    setSendingId(fx.id)
    setError(null)
    try {
      await api.sendFixture(token, fx.id)
    } catch (err) {
      setError(`${fx.label}: ${err.message || 'failed'}`)
    } finally {
      setSendingId(null)
    }
  }

  return (
    <div style={d.emptyWrap}>
      <div style={d.emptyContent}>
        <p style={d.emptyTitle}>waiting for requests…</p>
        <p style={d.emptySub}>send any http request to your inbox url and it appears here instantly.</p>

        <div style={d.curlBlock}>
          <div style={d.curlHead}>
            <span style={d.curlLabel}>example</span>
            <button
              type="button"
              onClick={onCopy}
              className="sb-copytest"
              style={d.curlCopyBtn}
              aria-label="copy example request"
            >
              <span className="material-symbols-outlined" style={{ fontSize: '13px' }}>content_copy</span>
              <span>copy</span>
            </button>
          </div>
          <pre style={d.curlCode}>{curl}</pre>
        </div>

        {fixtures.length > 0 && (
          <div style={fixturesBlock}>
            <div style={fixturesHead}>
              <span style={fixturesLabel}>or fire a real-shape webhook now</span>
            </div>
            <div style={fixturesRow}>
              {fixtures.map((fx) => (
                <button
                  key={fx.id}
                  type="button"
                  onClick={() => handleSendFixture(fx)}
                  disabled={sendingId === fx.id || !token}
                  className="sb-fixture"
                  title={fx.label}
                >
                  <span style={providerLabel}>{fx.provider}</span>
                  <span style={sepLabel}>·</span>
                  <span style={idLabel}>{fx.id}</span>
                  {sendingId === fx.id && <span style={spinnerLabel}>…</span>}
                </button>
              ))}
            </div>
          </div>
        )}

        {error && <div style={errMsg}>{error}</div>}

        <div style={d.tips}>
          {[
            'any method works — get, post, put, delete, patch…',
            'all headers and body are captured',
            'json bodies are pretty-printed automatically',
          ].map((tip) => (
            <div key={tip} style={d.tip}>{tip}</div>
          ))}
        </div>
      </div>
    </div>
  )
}

const fixturesBlock = {
  width: '100%',
  display: 'flex',
  flexDirection: 'column',
  gap: '8px',
}

const fixturesHead = {
  display: 'flex',
  alignItems: 'center',
}

const fixturesLabel = {
  fontFamily: c.mono,
  fontSize: '10px',
  color: c.faint,
  letterSpacing: '0.18em',
  textTransform: 'uppercase',
}

const fixturesRow = {
  display: 'flex',
  flexWrap: 'wrap',
  gap: '6px',
}

const fixtureBtn = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: '6px',
  background: c.low,
  border: '1px solid ' + c.border,
  borderRadius: '4px',
  padding: '4px 8px',
  fontFamily: c.mono,
  fontSize: '11px',
  color: c.dim,
  cursor: 'pointer',
  transition: 'border-color 0.12s, color 0.12s',
  opacity: 1,
}

const providerLabel = { color: c.fg, textTransform: 'lowercase' }
const sepLabel = { color: c.faint }
const idLabel = { color: c.dim }
const spinnerLabel = { color: c.faint, marginLeft: '4px' }

const errMsg = {
  fontSize: '11px',
  color: 'var(--status-red)',
  fontFamily: c.mono,
}
