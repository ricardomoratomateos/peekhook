import { useState } from 'react'
import { c } from '../lib/tokens.js'

const SCRIPT_MAX = 8192

function McpTokenCard({ mcpToken, inboxToken }) {
  const [copied, setCopied] = useState(false)
  const [open, setOpen] = useState(false)

  async function handleCopy() {
    try { await navigator.clipboard.writeText(mcpToken) } catch (_) {}
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div style={wrap}>
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="sb-replybtn"
        style={headBtn}
        aria-expanded={open}
      >
        <span style={headLeft}>
          <span style={title}>MCP</span>
          <span style={pill}>{copied ? 'copied' : 'token'}</span>
        </span>
        <span className="material-symbols-outlined" style={chev}>{open ? 'expand_less' : 'expand_more'}</span>
      </button>

      {open && (
        <>
          <div style={tokenRow}>
            <span style={tokenText} title={mcpToken}>{mcpToken}</span>
            <button
              type="button"
              onClick={handleCopy}
              className="sb-copy"
              style={copyBtn}
              aria-label={copied ? 'Copied' : 'Copy MCP token'}
            >
              <span className="material-symbols-outlined" style={{ fontSize: '14px' }}>
                {copied ? 'check' : 'content_copy'}
              </span>
            </button>
          </div>
          <div style={curlBlock}>
            <div style={curlHead}>
              <span style={curlLabel}>use from Claude Code / Cursor</span>
            </div>
            <pre style={curlCode}>{buildMcpSnippet(mcpToken, inboxToken)}</pre>
          </div>
          <p style={footer}>inbox: <span style={mono}>{inboxToken}</span></p>
        </>
      )}
    </div>
  )
}

function buildMcpSnippet(mcpToken, inboxToken) {
  return `# 1. capture something
curl -X POST http://localhost:3000/i/${inboxToken} \\
  -H 'content-type: application/json' -d '{}'

# 2. ask your agent: "list recent events on the inbox"

# the MCP tools (peekhook.list_events,
# peekhook.get_event, peekhook.search_events,
# peekhook.diff_events, peekhook.explain_event)
# are invoked automatically by the agent`
}

const wrap = {
  margin: '0 12px 14px',
  padding: '12px',
  border: '1px solid ' + c.border,
  borderRadius: '6px',
  background: c.bg,
  flexShrink: 0,
  display: 'flex',
  flexDirection: 'column',
  gap: '8px',
  transition: 'padding 0.15s ease',
}

const headBtn = {
  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
  gap: '8px', background: 'transparent', border: 'none', padding: '2px 0',
  cursor: 'pointer', borderRadius: '4px', width: '100%', textAlign: 'left',
}

const headLeft = { display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0 }
const title = { fontFamily: c.mono, fontSize: '10px', fontWeight: 600, color: c.faint, letterSpacing: '0.2em', textTransform: 'uppercase' }
const pill = { fontFamily: c.mono, fontSize: '10px', color: c.dim, letterSpacing: '0.04em' }
const chev = { fontSize: '16px', color: c.faint, flexShrink: 0, transition: 'color 0.12s' }

const tokenRow = {
  display: 'flex', alignItems: 'center',
  border: '1px solid ' + c.border, borderRadius: '4px', overflow: 'hidden',
  background: c.lowest,
}
const tokenText = {
  flex: 1, fontFamily: c.mono, fontSize: '10px', color: c.dim,
  padding: '6px 8px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
}
const copyBtn = {
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  background: c.ctr, border: 'none', borderLeft: '1px solid ' + c.border,
  color: c.dim, padding: '6px 9px', cursor: 'pointer', flexShrink: 0,
}

const curlBlock = {
  width: '100%', border: '1px solid ' + c.border, borderRadius: '6px',
  overflow: 'hidden',
}
const curlHead = { padding: '6px 12px', background: c.low, borderBottom: '1px solid ' + c.borderSoft }
const curlLabel = { fontFamily: c.mono, fontSize: '10px', color: c.dim, letterSpacing: '0.18em', textTransform: 'uppercase' }
const curlCode = {
  padding: '10px 12px', fontSize: '11px', color: c.fg, fontFamily: c.mono,
  lineHeight: 1.6, background: c.lowest, overflowX: 'auto', whiteSpace: 'pre', margin: 0,
}

const footer = { fontFamily: c.mono, fontSize: '10px', color: c.faint, letterSpacing: '0.06em', margin: 0 }
const mono = { color: c.dim }

export default McpTokenCard
