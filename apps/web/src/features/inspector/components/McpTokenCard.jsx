import { useState } from 'react'
import { api } from '../../../lib/api.js'
import { mc } from '../styles.js'

function McpTokenCard({ mcpToken: initialToken, inboxToken, onTokenChange }) {
  const [token, setToken] = useState(initialToken)
  const [copied, setCopied] = useState(false)
  const [minting, setMinting] = useState(false)
  const [mintError, setMintError] = useState(null)

  const mcpUrl = mcpEndpoint()

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

  const [copiedConfig, setCopiedConfig] = useState(null)

  async function handleCopyConfig(label, body) {
    try { await navigator.clipboard.writeText(body) } catch (_) {}
    setCopiedConfig(label)
    setTimeout(() => setCopiedConfig(null), 2000)
  }

  return (
    <div style={mc.section}>
      <div style={mc.card}>
        <span style={mc.cardTitle}>mcp endpoint</span>
        <p style={mc.mcpHint}>
          point any MCP-compatible client (Claude Code, Cursor, Cline, …) at this URL
          with the inbox token as the Bearer credential. No local process required.
        </p>

        <div style={mc.urlRow}>
          <code style={mc.urlText} title={mcpUrl}>{mcpUrl}</code>
          <button
            type="button"
            onClick={() => handleCopyConfig('url', mcpUrl)}
            className="sb-copy"
            style={mc.tokenCopy}
            aria-label={copiedConfig === 'url' ? 'Copied URL' : 'Copy MCP URL'}
          >
            <span className="material-symbols-outlined" style={{ fontSize: '14px' }}>
              {copiedConfig === 'url' ? 'check' : 'link'}
            </span>
            <span>{copiedConfig === 'url' ? 'copied' : 'copy url'}</span>
          </button>
        </div>

        {token ? (
          <>
            <span style={mc.cardTitle}>bearer token</span>
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
          <div style={mc.curlHead}>connect from your client</div>
          <ConfigSnippet
            label="claude desktop / claude code"
            body={buildClaudeSnippet(mcpUrl, token)}
            onCopy={handleCopyConfig}
            copied={copiedConfig === 'claude'}
          />
          <ConfigSnippet
            label="cursor"
            body={buildCursorSnippet(mcpUrl, token)}
            onCopy={handleCopyConfig}
            copied={copiedConfig === 'cursor'}
          />
          <ConfigSnippet
            label="curl (any MCP client)"
            body={buildCurlSnippet(mcpUrl, token)}
            onCopy={handleCopyConfig}
            copied={copiedConfig === 'curl'}
          />
        </div>
      )}
    </div>
  )
}

function ConfigSnippet({ label, body, onCopy, copied }) {
  return (
    <div style={mc.configGroup}>
      <div style={mc.configHead}>
        <span style={mc.configLabel}>{label}</span>
        <button
          type="button"
          onClick={() => onCopy(label.split(' ')[0], body)}
          className="sb-copy"
          style={mc.tokenCopy}
          aria-label={`Copy ${label}`}
        >
          <span className="material-symbols-outlined" style={{ fontSize: '13px' }}>
            {copied ? 'check' : 'content_copy'}
          </span>
          <span>{copied ? 'copied' : 'copy'}</span>
        </button>
      </div>
      <pre style={mc.configCode}>{body}</pre>
    </div>
  )
}

function mcpEndpoint() {
  if (typeof window === 'undefined') return '/mcp'
  return `${window.location.origin}/mcp`
}

function buildClaudeSnippet(url, token) {
  return JSON.stringify({
    mcpServers: {
      peekhook: {
        type: 'http',
        url,
        headers: { Authorization: `Bearer ${token}` },
      },
    },
  }, null, 2)
}

function buildCursorSnippet(url, token) {
  return JSON.stringify({
    mcpServers: {
      peekhook: {
        url,
        headers: { Authorization: `Bearer ${token}` },
      },
    },
  }, null, 2)
}

function buildCurlSnippet(url, token) {
  return [
    'curl -s -X POST ' + url,
    '  -H "Content-Type: application/json"',
    '  -H "Authorization: Bearer ' + token + '"',
    '  -H "Accept: application/json, text/event-stream"',
    "  -d '{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"tools/list\"}'",
  ].join(' \\\n')
}

export default McpTokenCard
