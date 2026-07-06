import { useState } from 'react'
import { api } from '../../../lib/api.js'
import { c } from '../lib/tokens.js'

function McpTokenCard({ mcpToken: initialToken, inboxToken, onTokenChange }) {
  const [token, setToken] = useState(initialToken)
  const [copied, setCopied] = useState(false)
  const [open, setOpen] = useState(!!initialToken)
  const [minting, setMinting] = useState(false)
  const [mintError, setMintError] = useState(null)

  async function handleCopy() {
    if (!token) return
    try { await navigator.clipboard.writeText(token) } catch (_) {}
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  async function handleMint() {
    setMintError(null)
    setMinting(true)
    try {
      const result = await api.regenerateMcpToken(inboxToken)
      const fresh = result.mcp_token
      setToken(fresh)
      setOpen(true)
      try {
        localStorage.setItem(`peekhook-${inboxToken}`, JSON.stringify({
          ...JSON.parse(localStorage.getItem(`peekhook-${inboxToken}`) || '{}'),
          mcpToken: fresh,
        }))
      } catch (_) {}
      if (onTokenChange) onTokenChange(fresh)
    } catch (err) {
      setMintError(err.message || 'failed to mint mcp token')
    } finally {
      setMinting(false)
    }
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
          <span style={pill}>{token ? (copied ? 'copied' : 'token') : (minting ? 'minting…' : 'no token')}</span>
        </span>
        <span className="material-symbols-outlined" style={chev}>{open ? 'expand_less' : 'expand_more'}</span>
      </button>

      {open && (
        <>
          {token ? (
            <>
              <div style={tokenRow}>
                <span style={tokenText} title={token}>{token}</span>
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
                <pre style={curlCode}>{buildMcpSnippet(token, inboxToken)}</pre>
              </div>
              <button
                type="button"
                onClick={handleMint}
                disabled={minting}
                className="sb-mint"
                style={{ ...mintBtn, ...(minting ? mintBtnDisabled : {}) }}
              >
                <span className="material-symbols-outlined" style={{ fontSize: '13px' }}>refresh</span>
                <span>{minting ? 'minting…' : 'regenerate token'}</span>
              </button>
              <p style={footer}>inbox: <span style={mono}>{inboxToken}</span></p>
              {mintError && <div style={err}>{mintError}</div>}
            </>
          ) : (
            <>
              <p style={emptyMsg}>
                mcp tokens are only returned once at inbox creation.
                if you opened this URL directly, the plaintext is gone.
              </p>
              <button
                type="button"
                onClick={handleMint}
                disabled={minting}
                className="sb-mint"
                style={{ ...mintBtn, ...(minting ? mintBtnDisabled : {}) }}
              >
                <span className="material-symbols-outlined" style={{ fontSize: '13px' }}>add</span>
                <span>{minting ? 'minting…' : 'mint a fresh token'}</span>
              </button>
              {mintError && <div style={err}>{mintError}</div>}
            </>
          )}
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

const mintBtn = {
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  gap: '6px', background: 'transparent',
  border: '1px dashed ' + c.border, borderRadius: '4px',
  color: c.dim, padding: '6px 10px', fontFamily: c.mono, fontSize: '11px',
  letterSpacing: '0.04em', cursor: 'pointer', transition: 'border-color 0.12s, color 0.12s',
}
const mintBtnDisabled = { opacity: 0.5, cursor: 'wait' }

const emptyMsg = {
  fontSize: '11px', color: c.faint, lineHeight: 1.5, fontFamily: c.sans,
  margin: 0,
}

const footer = { fontFamily: c.mono, fontSize: '10px', color: c.faint, letterSpacing: '0.06em', margin: 0 }
const mono = { color: c.dim }

const err = {
  fontSize: '11px', color: 'var(--status-red)', fontFamily: c.mono, marginTop: '2px',
}

export default McpTokenCard
