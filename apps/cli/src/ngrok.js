import { spawn } from 'node:child_process'
import { setTimeout as delay } from 'node:timers/promises'
import http from 'node:http'

const DEFAULT_PORT = 4040
const TUNNEL_PORT = 4041

export async function startNgrok({ upstreamPort = TUNNEL_PORT, region = 'us' } = {}) {
  const proc = spawn(
    'ngrok',
    ['http', String(upstreamPort), '--region', region, '--log', 'stdout'],
    { stdio: ['ignore', 'pipe', 'pipe'] },
  )

  proc.stdout.on('data', () => {})
  proc.stderr.on('data', () => {})
  proc.on('exit', (code) => {
    if (code !== null && code !== 0 && code !== 143) {
      console.error(`ngrok exited unexpectedly with code ${code}`)
    }
  })

  let url = null
  for (let i = 0; i < 50; i++) {
    await delay(200)
    try {
      const tunnels = await fetchTunnels()
      if (tunnels.length > 0) {
        url = tunnels[0].public_url
        break
      }
    } catch (_) {}
  }

  if (!url) {
    proc.kill('SIGTERM')
    throw new Error(
      'ngrok did not become ready in 10s. Is it installed? Try: brew install ngrok/ngrok/ngrok',
    )
  }

  const token = generateToken()
  return {
    url: `${url}/${token}`,
    token,
    close: () => proc.kill('SIGTERM'),
  }
}

async function fetchTunnels() {
  return new Promise((resolve, reject) => {
    const req = http.get(`http://127.0.0.1:${DEFAULT_PORT}/api/tunnels`, (res) => {
      let body = ''
      res.on('data', (chunk) => (body += chunk))
      res.on('end', () => {
        try {
          const parsed = JSON.parse(body)
          resolve(parsed.tunnels || [])
        } catch (err) {
          reject(err)
        }
      })
    })
    req.on('error', reject)
  })
}

function generateToken() {
  return Array.from(crypto.getRandomValues(new Uint8Array(16)))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}
