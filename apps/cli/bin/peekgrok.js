#!/usr/bin/env bun
import { Database } from 'bun:sqlite'
import { startNgrok } from '../src/ngrok.js'
import { startLocalServer } from '@peekhook/api/src/cli.js'
import { startProxyServer } from '../src/proxyServer.js'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { homedir } from 'node:os'
import { fileURLToPath } from 'node:url'

const VERSION = '0.1.0'
const DEFAULT_PORT = 4041        // inspector + /api + /mcp (local; you look here)
const DEFAULT_PROXY_PORT = 4042  // catch-all sniffer (ngrok tunnels this)

// Normalise a `--to` value into an upstream base URL.
//   "8080"                  -> "http://localhost:8080"
//   "localhost:8080"        -> "http://localhost:8080"
//   "http://127.0.0.1:8080" -> unchanged
function normalizeUpstream(raw) {
  if (!raw) return null
  const s = String(raw).trim()
  if (/^\d+$/.test(s)) return `http://localhost:${s}`
  if (/^https?:\/\//i.test(s)) return s
  return `http://${s}`
}

const argv = process.argv.slice(2)
const cmd = argv[0]

function flagValue(names, fallback = null) {
  const list = Array.isArray(names) ? names : [names]
  for (const name of list) {
    const i = argv.indexOf(name)
    if (i >= 0 && i + 1 < argv.length) return argv[i + 1]
  }
  return fallback
}
const hasFlag = (name) => argv.includes(name)

function usage() {
  console.error('Usage: peekgrok listen [options]')
  console.error('')
  console.error('Options:')
  console.error('  --to <port|url>        SNIFFER mode: forward all traffic to your app,')
  console.error('                         capturing every request/response in between')
  console.error('                         (e.g. --to 8080  or  --to http://localhost:8080)')
  console.error('  --port <port>          inspector/API/MCP port (default 4041, local only)')
  console.error('  --proxy-port <port>    sniffer port ngrok tunnels (default 4042)')
  console.error('  --no-tunnel            skip ngrok, serve on localhost only')
  console.error('  --ngrok-url <domain>   use a reserved ngrok domain (e.g. rmorato.ngrok.app)')
  console.error('  --ngrok-region <r>     ngrok region (omit to honor ~/.config/ngrok/ngrok.yml)')
  console.error('  --web-dist <path>      path to a built apps/web/dist (or set PEEKHOOK_WEB_DIST)')
  console.error('  --data-dir <path>      db location (default ~/.peekhook; isolate sessions)')
  console.error('  --fresh                force a new inbox instead of reusing the last one')
  console.error('')
  console.error('Examples:')
  console.error('  peekgrok listen --to 8080                    # sniff traffic to localhost:8080')
  console.error('  peekgrok listen --to http://localhost:8080 --ngrok-url rmorato.ngrok.app')
  console.error('  peekgrok listen                              # webhook-inbox mode (no forwarding)')
  console.error('  peekgrok listen --no-tunnel')
}

if (cmd !== 'listen') {
  usage()
  process.exit(1)
}

const port = parseInt(flagValue(['--port', '-p'], String(DEFAULT_PORT)), 10)
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  console.error(`Invalid --port: ${flagValue(['--port', '-p'])} (expected 1-65535)`)
  process.exit(1)
}
const noTunnel     = hasFlag('--no-tunnel')
const ngrokUrl     = flagValue(['--ngrok-url'])
const ngrokRegion  = flagValue(['--ngrok-region'])
const customWebDist = flagValue(['--web-dist'])
const dataDirFlag   = flagValue(['--data-dir'])
const freshInbox    = hasFlag('--fresh')

// Sniffer mode: `--to <port|url>` turns peekgrok into a transparent reverse
// proxy in front of your app (the ngrok-inspector model). Absent → the
// classic webhook-inbox mode (traffic terminates at /i/:token).
const upstream = normalizeUpstream(flagValue(['--to', '--upstream']))
const sniffer  = Boolean(upstream)
const proxyPort = parseInt(flagValue(['--proxy-port'], String(DEFAULT_PROXY_PORT)), 10)
if (sniffer && (!Number.isInteger(proxyPort) || proxyPort < 1 || proxyPort > 65535)) {
  console.error(`Invalid --proxy-port: ${flagValue(['--proxy-port'])} (expected 1-65535)`)
  process.exit(1)
}
if (sniffer && proxyPort === port) {
  console.error(`--proxy-port (${proxyPort}) must differ from --port (${port})`)
  process.exit(1)
}

const dataDir = dataDirFlag ? resolve(dataDirFlag) : join(homedir(), '.peekhook')
if (!existsSync(dataDir)) mkdirSync(dataDir, { recursive: true })
const dbPath = join(dataDir, 'peekgrok.db')

// Discover the web dist: explicit flag, env var, then a couple of
// standard locations relative to this file (works for both the
// monorepo checkout and the compiled binary).
function findWebDist() {
  if (customWebDist) return resolve(customWebDist)
  if (process.env.PEEKHOOK_WEB_DIST) return resolve(process.env.PEEKHOOK_WEB_DIST)
  const here = dirname(fileURLToPath(import.meta.url))
  const candidates = [
    join(here, '..', '..', '..', 'apps', 'web', 'dist'),
    join(here, '..', '..', '..', '..', 'apps', 'web', 'dist'),
    join(process.cwd(), 'apps', 'web', 'dist'),
    join(process.cwd(), 'web', 'dist'),
  ]
  for (const p of candidates) {
    if (existsSync(join(p, 'index.html'))) return p
  }
  return null
}
const webDist = findWebDist()

const db = new Database(dbPath)

// 1. Start the local server first so we can mint an inbox against it and
//    hand back a ready-to-paste URL.
const server = await startLocalServer({ port, db, dataDir, webDist })

// 2. Get an inbox. Reuse the one from the last run if it still exists in the
//    db (keeps the webhook URL, captured history, and MCP token stable across
//    restarts); otherwise mint a fresh one. The MCP token's plaintext is only
//    returned once at creation and stored hashed, so we stash {token,mcpToken}
//    in a local 0600 session file — that's the only way to reuse the SAME MCP
//    token instead of rotating it every launch.
const sessionPath = join(dataDir, 'session.json')

async function inboxExists(tk) {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/inboxes/${tk}`)
    return res.ok
  } catch (_) {
    return false
  }
}

async function mintInbox() {
  const res = await fetch(`http://127.0.0.1:${port}/api/inboxes`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{}',
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const body = await res.json()
  return { token: body.token, mcpToken: body.mcp_token }
}

let token = null
let mcpToken = null
let reusedInbox = false

if (!freshInbox) {
  try {
    if (existsSync(sessionPath)) {
      const saved = JSON.parse(readFileSync(sessionPath, 'utf8'))
      if (saved.token && (await inboxExists(saved.token))) {
        token = saved.token
        mcpToken = saved.mcpToken ?? null
        reusedInbox = true
      }
    }
  } catch (_) {
    /* corrupt/missing session file → fall through to a fresh mint */
  }
}

if (!token) {
  try {
    const fresh = await mintInbox()
    token = fresh.token
    mcpToken = fresh.mcpToken
    try {
      writeFileSync(sessionPath, JSON.stringify({ token, mcpToken }, null, 2), { mode: 0o600 })
    } catch (_) { /* non-fatal: reuse just won't persist */ }
  } catch (err) {
    console.error(`warning: could not mint an inbox (${err.message})`)
  }
}

// 3. Sniffer mode: stand up the catch-all reverse proxy in front of your
//    app. This is the surface ngrok tunnels; the inspector stays local.
let proxy = null
if (sniffer) {
  if (!token) {
    console.error('sniffer mode needs a session inbox but the mint failed — aborting')
    await server.close(); db.close(); process.exit(1)
  }
  try {
    proxy = await startProxyServer({
      port:                proxyPort,
      upstream,
      sessionToken:        token,
      inboxRepo:           server.inboxRepo,
      capturedRequestRepo: server.capturedRequestRepo,
      ingestOrigin:        `http://localhost:${proxyPort}`,
    })
  } catch (err) {
    console.error(`could not start sniffer proxy on :${proxyPort} — ${err.message}`)
    await server.close(); db.close(); process.exit(1)
  }
}

// 4. Optional public tunnel. In sniffer mode ngrok points at the proxy
//    port (so the public URL forwards straight to your app); otherwise at
//    the inspector/ingest port.
const tunnelPort = sniffer ? proxyPort : port
let tunnel = null
if (!noTunnel) {
  try {
    tunnel = await startNgrok({ port: tunnelPort, url: ngrokUrl, region: ngrokRegion })
  } catch (err) {
    console.error(`tunnel skipped — ${err.message}`)
    console.error('  (pass --no-tunnel to suppress this attempt)')
  }
}

// 5. Summary.
const localBase    = `http://localhost:${port}`
// Hand the MCP bearer token to the inspector SPA via the URL fragment
// (#mcp=...). It never hits the server; the SPA stashes it in localStorage
// so the MCP tab shows the SAME token printed below — no regenerate needed.
const inspectorUrl = token
  ? `${localBase}/i/${token}${mcpToken ? `#mcp=${mcpToken}` : ''}`
  : localBase

console.log(`peekgrok v${VERSION}`)
console.log(`  data:      ${dbPath}`)
console.log(`  web:       ${webDist ?? '(not found — pass --web-dist or set PEEKHOOK_WEB_DIST)'}`)
console.log(`  inbox:     ${reusedInbox ? 'reused from last session' : 'new'}`)
console.log(`  inspector: ${inspectorUrl}`)
if (sniffer) {
  console.log(`  upstream:  ${upstream}   (all traffic is forwarded here)`)
  console.log(`  proxy:     http://localhost:${proxyPort}   (capture + forward)`)
  if (tunnel) {
    console.log(`  public:    ${tunnel.url}   → sniffs → ${upstream}`)
  } else if (noTunnel) {
    console.log(`  tunnel:    (disabled — point clients at http://localhost:${proxyPort})`)
  }
} else {
  const webhookPath = token ? `/i/${token}` : '/i/<mint an inbox in the UI>'
  console.log(`  webhook:   ${localBase}${webhookPath}`)
  if (tunnel) {
    console.log(`  public:    ${tunnel.url}${webhookPath}`)
  } else if (noTunnel) {
    console.log('  tunnel:    (disabled via --no-tunnel)')
  }
}
if (mcpToken) {
  console.log(`  mcp:       ${localBase}/mcp  (Authorization: Bearer ${mcpToken})`)
}
console.log()
console.log('Press Ctrl+C to stop')

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.once(sig, async () => {
    console.log('\nShutting down...')
    if (proxy) await proxy.close()
    await server.close()
    if (tunnel) tunnel.close()
    db.close()
    process.exit(0)
  })
}
