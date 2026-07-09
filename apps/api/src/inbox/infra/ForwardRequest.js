import { checkForwardLoop } from '../domain/loopRule.js'

/**
 * ForwardRequest — proxies a captured incoming request out to a configured
 * HTTP(S) target. Pure adapter: no persistence, no capture. The caller
 * (ingest route) captures first, then invokes this, then persists the
 * upstream response back to the capture record.
 *
 * Why HTTP(S) only — and not raw TCP / WebSocket tunnel: peekhook is a
 * webhook inspector. The whole point of forwardTo is "send my webhook to
 * my localhost dev server." HTTP request/response covers every modern
 * webhook provider. WebSocket bidirectionality needs a long-lived control
 * channel (a custom client binary), which is out of scope.
 *
 * Safety properties:
 *   - timeoutMs enforced via AbortController; default 10s.
 *   - Loop guard: if the target URL's origin equals the configured public
 *     ingest origin AND its pathname starts with `/i/`, refuse
 *     immediately with `{ ok: false, error: 'loop' }`. Prevents a
 *     misconfigured inbox from recursing forever.
 *   - Hop-by-hop headers are stripped from both directions (RFC 7230 §6.1).
 *   - Failures (timeout, refused, non-2xx that does throw, malformed URL,
 *     DNS failure) all collapse to a tagged `error` string so the caller
 *     can surface a stable status to the original webhook sender.
 *
 * @param {{
 *   targetUrl:    string,
 *   method:       string,
 *   headers:      Record<string, string | string[] | undefined>,
 *   body:         string,
 *   ingestOrigin: string,   // e.g. "https://peekhook.dev" — for loop guard
 *   timeoutMs?:   number,
 *   fetchImpl?:   typeof fetch,
 *   now?:         () => number,
 * }} deps
 */
export class ForwardRequest {
  constructor({ targetUrl, method, headers, body, ingestOrigin, timeoutMs, fetchImpl, now }) {
    this.targetUrl    = targetUrl
    this.method       = method
    this.headers      = headers
    this.body         = body
    this.ingestOrigin = ingestOrigin
    this.timeoutMs    = timeoutMs ?? 10_000
    this.fetchImpl    = fetchImpl ?? globalThis.fetch
    this.now          = now ?? (() => Date.now())
  }

  /**
   * @returns {Promise<
   *   | { ok: true, status: number, headers: Record<string,string>, body: string, contentType: string, durationMs: number }
   *   | { ok: false, error: 'loop' | 'timeout' | 'fetch_failed', message: string, durationMs: number }
   * >}
   */
  async execute() {
    let target
    try {
      target = new URL(this.targetUrl)
    } catch (_err) {
      return { ok: false, error: 'fetch_failed', message: 'invalid target URL', durationMs: 0 }
    }

    if (this.#isLoop(target)) {
      return {
        ok: false,
        error: 'loop',
        message: `forwardTo would recurse into this ingest origin (${this.ingestOrigin})`,
        durationMs: 0,
      }
    }

    const start = this.now()
    const ac = new AbortController()
    const timer = setTimeout(() => ac.abort(), this.timeoutMs)

    const fwdHeaders = stripHopByHopHeaders({
      ...this.headers,
      host: target.host,
    })

    // GET/HEAD requests must not carry a body — undici (Node's fetch)
    // throws "Request with GET/HEAD method cannot have body" otherwise.
    // The sniffer forwards every method, so this guard is load-bearing
    // once GET traffic flows through.
    const method = (this.method || 'GET').toUpperCase()
    const init = {
      method,
      headers:  fwdHeaders,
      signal:   ac.signal,
      redirect: 'manual',
    }
    if (method !== 'GET' && method !== 'HEAD') {
      init.body = this.body ?? ''
    }

    try {
      const res = await this.fetchImpl(target, init)

      const contentType = res.headers.get('content-type') ?? ''
      const resHeaders = stripHopByHopHeaders(Object.fromEntries(res.headers.entries()))

      // Text-shaped responses (JSON / XML / HTML / plain / form / svg)
      // are read as UTF-8 strings so they display and store cleanly.
      // Everything else (images, fonts, protobuf, octet-stream) is read
      // as raw bytes and relayed verbatim — reading binary as UTF-8
      // mangles it. `body` stays a short placeholder for the capture
      // record; `bodyBuffer` carries the exact bytes for the relay.
      if (isTextual(contentType)) {
        const resBody = await res.text()
        return {
          ok: true,
          status:      res.status,
          headers:     resHeaders,
          body:        resBody,
          contentType,
          durationMs:  this.now() - start,
          isBinary:    false,
        }
      }

      const buf = Buffer.from(await res.arrayBuffer())
      return {
        ok: true,
        status:      res.status,
        headers:     resHeaders,
        body:        `[binary ${buf.length} bytes]`,
        bodyBuffer:  buf,
        contentType,
        durationMs:  this.now() - start,
        isBinary:    true,
      }
    } catch (err) {
      const durationMs = this.now() - start
      const isAbort = err && (err.name === 'AbortError' || ac.signal.aborted)
      if (isAbort) {
        return { ok: false, error: 'timeout', message: `timeout after ${this.timeoutMs}ms`, durationMs }
      }
      return {
        ok: false,
        error: 'fetch_failed',
        message: err && err.message ? String(err.message) : 'fetch failed',
        durationMs,
      }
    } finally {
      clearTimeout(timer)
    }
  }

  #isLoop(target) {
    return !checkForwardLoop(target.toString(), this.ingestOrigin).ok
  }
}

/**
 * Whether a content-type is text-shaped (safe to read as UTF-8) vs
 * binary. An empty content-type is treated as textual — that's the
 * common case for tiny JSON/text webhook acks that omit the header,
 * and treating them as binary would swap their body for a placeholder.
 */
function isTextual(contentType) {
  if (!contentType) return true
  const ct = contentType.toLowerCase()
  return (
    ct.startsWith('text/') ||
    ct.includes('json') ||
    ct.includes('xml') ||
    ct.includes('javascript') ||
    ct.includes('x-www-form-urlencoded') ||
    ct.includes('csv') ||
    ct.includes('yaml')
  )
}

const HOP_BY_HOP = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailers',
  'transfer-encoding',
  'upgrade',
])

function stripHopByHopHeaders(h) {
  if (!h || typeof h !== 'object') return {}
  const out = {}
  for (const [k, v] of Object.entries(h)) {
    if (v === undefined || v === null) continue
    if (HOP_BY_HOP.has(k.toLowerCase())) continue
    out[k] = typeof v === 'string' ? v : Array.isArray(v) ? v.join(', ') : String(v)
  }
  return out
}
