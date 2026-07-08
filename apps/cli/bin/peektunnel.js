#!/usr/bin/env bun
import { Database } from 'bun:sqlite'
import { startNgrok } from '../src/ngrok.js'
import { startLocalServer } from '@peekhook/api/src/cli.js'
import { existsSync, mkdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { homedir } from 'node:os'
import { fileURLToPath } from 'node:url'

const args = process.argv.slice(2)
const cmd = args[0]
const upstreamPort = parseInt(args[1] || '3000', 10)
const localPort = 4041
const noTunnel = args.includes('--no-tunnel')
const customWebDist = (() => {
  const i = args.indexOf('--web-dist')
  return i >= 0 ? args[i + 1] : null
})()

if (cmd !== 'listen') {
  console.error('Usage: peektunnel listen <port> [--no-tunnel] [--web-dist <path>]')
  console.error('Example: peektunnel listen 3000')
  console.error('         peektunnel listen 3000 --no-tunnel  # skip ngrok, dev mode')
  process.exit(1)
}

const dataDir = join(homedir(), '.peekhook')
if (!existsSync(dataDir)) mkdirSync(dataDir, { recursive: true })

// Discover the web dist: explicit flag, env var, then a couple of
// standard locations relative to this file (works for both the
// monorepo checkout and the binary).
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

console.log('peektunnel v0.1.0')
console.log(`  upstream:  http://localhost:${upstreamPort}`)
console.log(`  data:      ${dataDir}/peektunnel.db`)
if (webDist) console.log(`  web:       ${webDist}`)
else          console.log(`  web:       (not found — UI will 404; pass --web-dist or set PEEKHOOK_WEB_DIST)`)

const db = new Database(join(dataDir, 'peektunnel.db'))

let tunnel = null
if (!noTunnel) {
  try {
    tunnel = await startNgrok({ upstreamPort: localPort })
    console.log(`  tunnel:    ${tunnel.url}`)
  } catch (err) {
    console.log(`  tunnel:    (skipped — ${err.message})`)
    console.log('             pass --no-tunnel to suppress this attempt, or install ngrok')
  }
} else {
  console.log('  tunnel:    (skipped via --no-tunnel)')
}

console.log(`  inspector: http://localhost:${localPort}`)
console.log()
console.log('Press Ctrl+C to stop')

const server = await startLocalServer({ port: localPort, db, dataDir, webDist })

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.once(sig, async () => {
    console.log('\nShutting down...')
    await server.close()
    if (tunnel) tunnel.close()
    db.close()
    process.exit(0)
  })
}
