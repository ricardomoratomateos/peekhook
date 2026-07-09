import { spawn } from 'node:child_process'
import { setTimeout as delay } from 'node:timers/promises'
import http from 'node:http'

// ngrok's local agent API (the web inspector) always binds 4040. We poll
// it to discover the public URL once the tunnel is up. This is unrelated
// to the port we ask ngrok to forward.
const AGENT_API_PORT = 4040

/**
 * Spawn an ngrok tunnel forwarding the public URL to a local port.
 *
 * @param {{
 *   port:      number,          // local port to forward (the peekgrok server)
 *   url?:      string|null,     // reserved ngrok domain, e.g. 'rmorato.ngrok.app'
 *   region?:   string|null,     // ngrok region; omit to honor ~/.config/ngrok/ngrok.yml
 *   extraArgs?: string[],       // raw args appended verbatim to the ngrok invocation
 * }} opts
 * @returns {Promise<{ url: string, close: () => void }>} public URL (no path appended)
 */
export async function startNgrok({ port, url = null, region = null, extraArgs = [] } = {}) {
  if (!Number.isInteger(port)) {
    throw new Error('startNgrok: `port` is required and must be an integer')
  }

  const ngrokArgs = ['http', String(port)]
  if (url)    ngrokArgs.push('--url', url)
  if (region) ngrokArgs.push('--region', region)
  ngrokArgs.push('--log', 'stdout')
  if (extraArgs.length) ngrokArgs.push(...extraArgs)

  const proc = spawn('ngrok', ngrokArgs, { stdio: ['ignore', 'pipe', 'pipe'] })

  // Capture stderr so we can surface a useful message if ngrok dies early
  // (bad authtoken, domain not reserved, port already tunneled, …).
  let stderrTail = ''
  proc.stdout.on('data', () => {})
  proc.stderr.on('data', (chunk) => {
    stderrTail = (stderrTail + chunk.toString()).slice(-2000)
  })
  proc.on('exit', (code) => {
    if (code !== null && code !== 0 && code !== 143) {
      console.error(`ngrok exited unexpectedly with code ${code}`)
    }
  })

  let publicUrl = null
  for (let i = 0; i < 50; i++) {
    if (proc.exitCode !== null) break
    await delay(200)
    try {
      const tunnels = await fetchTunnels()
      // Prefer the https tunnel when ngrok opens both http + https.
      const chosen = tunnels.find((t) => t.public_url?.startsWith('https://')) ?? tunnels[0]
      if (chosen) {
        publicUrl = chosen.public_url
        break
      }
    } catch (_) {}
  }

  if (!publicUrl) {
    proc.kill('SIGTERM')
    const hint = stderrTail.trim()
    throw new Error(
      'ngrok did not become ready in 10s. Is it installed and authenticated? ' +
        'Try: brew install ngrok/ngrok/ngrok && ngrok config add-authtoken <token>' +
        (hint ? `\n  ngrok said: ${hint}` : ''),
    )
  }

  return {
    url: publicUrl,
    close: () => proc.kill('SIGTERM'),
  }
}

async function fetchTunnels() {
  return new Promise((resolve, reject) => {
    const req = http.get(`http://127.0.0.1:${AGENT_API_PORT}/api/tunnels`, (res) => {
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
