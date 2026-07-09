import { describe, it, expect } from 'vitest'
import { ForwardRequest } from './ForwardRequest.js'

function makeFetch(status, body, opts = {}) {
  return async (url, init) => {
    opts.calls.push({ url: String(url), init })
    return new Response(body, {
      status,
      headers: { 'content-type': opts.contentType ?? 'text/plain', 'x-up': 'yes' },
    })
  }
}

describe('ForwardRequest', () => {
  it('forwards method, headers, body to the target URL', async () => {
    const calls = []
    const f = new ForwardRequest({
      targetUrl:    'http://localhost:3001/hook',
      method:       'POST',
      headers:      { 'content-type': 'application/json', 'x-custom': 'one' },
      body:         '{"a":1}',
      ingestOrigin: 'https://peekhook.example',
      fetchImpl:    makeFetch(202, 'ok', { calls }),
      now: () => 0,
    })
    f.now = () => 0
    f.fetchImpl = async (url, init) => {
      calls.push({ url: String(url), init })
      return new Response('ok', {
        status: 202,
        headers: { 'content-type': 'text/plain', 'x-up': 'yes' },
      })
    }

    const result = await f.execute()
    expect(result.ok).toBe(true)
    expect(result.status).toBe(202)
    expect(result.body).toBe('ok')
    expect(result.contentType).toBe('text/plain')

    expect(calls).toHaveLength(1)
    const call = calls[0]
    expect(call.url).toBe('http://localhost:3001/hook')
    expect(call.init.method).toBe('POST')
    expect(call.init.body).toBe('{"a":1}')
    expect(call.init.headers['content-type']).toBe('application/json')
    expect(call.init.headers['x-custom']).toBe('one')
    expect(call.init.headers.host).toBe('localhost:3001')
  })

  it('strips hop-by-hop request and response headers', async () => {
    const calls = []
    const fetchImpl = async (url, init) => {
      calls.push({ url: String(url), init })
      return new Response('ok', {
        status: 200,
        headers: {
          'content-type':    'text/plain',
          'connection':      'keep-alive',
          'transfer-encoding': 'chunked',
          'keep-alive':      'timeout=5',
          'x-ok':            'forwarded',
        },
      })
    }
    const f = new ForwardRequest({
      targetUrl:    'http://target.example/hook',
      method:       'POST',
      headers:      {
        'content-type':       'text/plain',
        'connection':         'keep-alive',
        'transfer-encoding':  'chunked',
        'x-real':             'one',
      },
      body:         'ping',
      ingestOrigin: 'https://peekhook.example',
      fetchImpl,
      now: () => 0,
    })

    const result = await f.execute()
    expect(result.ok).toBe(true)
    expect(Object.keys(result.headers).sort()).toEqual(['content-type', 'x-ok'])
    expect(calls[0].init.headers.connection).toBeUndefined()
    expect(calls[0].init.headers['transfer-encoding']).toBeUndefined()
  })

  it('refuses to forward when target loops back into the ingest origin via /i/...', async () => {
    const calls = []
    const fetchImpl = async () => {
      calls.push('called')
      return new Response()
    }
    const f = new ForwardRequest({
      targetUrl:    'https://peekhook.example/i/abc/token',
      method:       'POST',
      headers:      {},
      body:         '',
      ingestOrigin: 'https://peekhook.example',
      fetchImpl,
      now: () => 0,
    })

    const result = await f.execute()
    expect(result.ok).toBe(false)
    expect(result.error).toBe('loop')
    expect(calls).toHaveLength(0)
  })

  it('allows a target whose origin matches but path does not start with /i/', async () => {
    const calls = []
    const fetchImpl = async (url) => {
      calls.push(String(url))
      return new Response('hi', { status: 200, headers: { 'content-type': 'text/plain' } })
    }
    const f = new ForwardRequest({
      targetUrl:    'https://peekhook.example/healthz',
      method:       'GET',
      headers:      {},
      body:         '',
      ingestOrigin: 'https://peekhook.example',
      fetchImpl,
      now: () => 0,
    })

    const result = await f.execute()
    expect(result.ok).toBe(true)
    expect(calls).toHaveLength(1)
  })

  it('returns timeout when the upstream does not respond within timeoutMs', async () => {
    const fetchImpl = async (_url, init) => {
      return await new Promise((resolve, reject) => {
        init.signal.addEventListener('abort', () => {
          const err = new Error('aborted')
          err.name = 'AbortError'
          reject(err)
        })
      })
    }
    const f = new ForwardRequest({
      targetUrl:    'http://10.255.255.1/slow',
      method:       'POST',
      headers:      {},
      body:         '',
      ingestOrigin: 'https://peekhook.example',
      timeoutMs:    25,
      fetchImpl,
      now: () => 0,
    })

    const result = await f.execute()
    expect(result.ok).toBe(false)
    expect(result.error).toBe('timeout')
  })

  it('returns fetch_failed when fetch throws a non-abort error', async () => {
    const fetchImpl = async () => {
      const err = new Error('ECONNREFUSED')
      throw err
    }
    const f = new ForwardRequest({
      targetUrl:    'http://127.0.0.1:1/down',
      method:       'POST',
      headers:      {},
      body:         '',
      ingestOrigin: 'https://peekhook.example',
      fetchImpl,
      now: () => 0,
    })

    const result = await f.execute()
    expect(result.ok).toBe(false)
    expect(result.error).toBe('fetch_failed')
    expect(result.message).toBe('ECONNREFUSED')
  })

  it('reads a binary upstream response as raw bytes, not mangled UTF-8', async () => {
    const bytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0xff, 0xfe])  // PNG-ish header + non-UTF8 bytes
    const fetchImpl = async () => new Response(bytes, {
      status: 200,
      headers: { 'content-type': 'image/png' },
    })
    const f = new ForwardRequest({
      targetUrl:    'http://target.example/logo.png',
      method:       'GET',
      headers:      {},
      body:         '',
      ingestOrigin: 'https://peekhook.example',
      fetchImpl,
      now: () => 0,
    })

    const result = await f.execute()
    expect(result.ok).toBe(true)
    expect(result.isBinary).toBe(true)
    expect(Buffer.isBuffer(result.bodyBuffer)).toBe(true)
    expect(result.bodyBuffer.equals(bytes)).toBe(true)
    expect(result.body).toMatch(/^\[binary \d+ bytes\]$/)
  })

  it('omits the request body for GET/HEAD so undici does not throw', async () => {
    let seenInit = null
    const fetchImpl = async (_url, init) => {
      seenInit = init
      return new Response('hi', { status: 200, headers: { 'content-type': 'text/plain' } })
    }
    const f = new ForwardRequest({
      targetUrl:    'http://target.example/callback',
      method:       'GET',
      headers:      {},
      body:         'should-be-dropped',
      ingestOrigin: 'https://peekhook.example',
      fetchImpl,
      now: () => 0,
    })

    const result = await f.execute()
    expect(result.ok).toBe(true)
    expect(seenInit.body).toBeUndefined()
  })

  it('returns fetch_failed when targetUrl is not a valid URL', async () => {
    const f = new ForwardRequest({
      targetUrl:    'not a url',
      method:       'POST',
      headers:      {},
      body:         '',
      ingestOrigin: 'https://peekhook.example',
      fetchImpl:    async () => new Response(),
      now: () => 0,
    })

    const result = await f.execute()
    expect(result.ok).toBe(false)
    expect(result.error).toBe('fetch_failed')
  })
})
