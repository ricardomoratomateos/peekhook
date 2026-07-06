import { useState } from 'react'
import { c } from '../lib/tokens.js'
import { s, d } from '../styles.js'
import McpTokenCard from '../components/McpTokenCard.jsx'
import { buildTestCurl } from '../lib/format.js'

export default function McpPage({ token, mcpToken }) {
  const [copiedTest, setCopiedTest] = useState(false)

  async function handleCopyTest() {
    const inboxUrl = `${typeof window !== 'undefined' ? window.location.origin : ''}/i/${token}`
    try { await navigator.clipboard.writeText(buildTestCurl(inboxUrl)) } catch (_) {}
    setCopiedTest(true)
    setTimeout(() => setCopiedTest(false), 1800)
  }

  return (
    <div style={s.page}>
      <header style={s.pageHeader}>
        <div style={d.eyebrow}>sandbox · mcp</div>
        <div style={s.pageHeaderRow}>
          <div style={d.headlineRow}>
            <span style={d.methodLg}>mcp</span>
            <span style={d.pathLg}>/ token</span>
          </div>
          <div style={s.pageHeaderRight}>
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
      <div style={s.pageBody}>
        <McpTokenCard mcpToken={mcpToken} inboxToken={token} />
      </div>
    </div>
  )
}