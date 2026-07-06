import { useState } from 'react'
import { api } from '../../../lib/api.js'
import { mc } from '../styles.js'

function McpTokenCard({ mcpToken: initialToken, inboxToken, onTokenChange }) {
  const [token, setToken] = useState(initialToken)
  const [copied, setCopied] = useState(false)
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
    <div style={mc.section}>
      <div style={mc.card}>
        <span style={mc.cardTitle}>token</span>

        {token ? (
          <>
            <div style={mc.tokenRow}>
              <span style={mc.tokenText} title={token}>{token}</span>
              <button
                type="button"
                onClick={handleCopy}
                className="sb-copy"
                style={mc.tokenCopy}
                aria-label={copied ? 'Copied' : 'Copy MCP token'}
              >
                <span className="material-symbols-outlined" style={{ fontSize: '14px' }}>
                  {copied ? 'check' : 'content_copy'}
                </span>
                <span>{copied ? 'copied' : 'copy'}</span>
              </button>
            </div>

            <div style={mc.actionRow}>
              <button
                type="button"
                onClick={handleMint}
                disabled={minting}
                className="sb-mint"
                style={{ ...mc.mintBtn, ...(minting ? mc.mintBtnDisabled : {}) }}
              >
                <span className="material-symbols-outlined" style={{ fontSize: '13px' }}>refresh</span>
                <span>{minting ? 'minting…' : 'regenerate token'}</span>
              </button>
              <span style={mc.footer}>
                inbox<span style={mc.footerInbox}>{inboxToken}</span>
              </span>
            </div>

            {mintError && <div style={mc.err}>{mintError}</div>}
          </>
        ) : (
          <>
            <p style={mc.emptyMsg}>
              mcp tokens are only returned once at inbox creation.
              if you opened this URL directly, the plaintext is gone.
            </p>
            <div>
              <button
                type="button"
                onClick={handleMint}
                disabled={minting}
                className="sb-mint"
                style={{ ...mc.mintBtn, ...(minting ? mc.mintBtnDisabled : {}) }}
              >
                <span className="material-symbols-outlined" style={{ fontSize: '13px' }}>add</span>
                <span>{minting ? 'minting…' : 'mint a fresh token'}</span>
              </button>
            </div>
            {mintError && <div style={mc.err}>{mintError}</div>}
          </>
        )}
      </div>

      {token && (
        <div style={mc.curlBlock}>
          <div style={mc.curlHead}>use from Claude Code / Cursor</div>
          <pre style={mc.curlCode}>{buildMcpSnippet(token, inboxToken)}</pre>
        </div>
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

export default McpTokenCard