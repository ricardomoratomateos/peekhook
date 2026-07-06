import { describe, it, expect } from 'vitest'
import { checkForwardLoop } from './loopRule.js'

const INGEST = 'https://peekhook.dev'

describe('checkForwardLoop', () => {
  it('returns ok when forwardTo is null/empty/undefined', () => {
    expect(checkForwardLoop(null, INGEST)).toEqual({ ok: true })
    expect(checkForwardLoop(undefined, INGEST)).toEqual({ ok: true })
    expect(checkForwardLoop('', INGEST)).toEqual({ ok: true })
  })

  it('returns ok when ingestOrigin is null/empty/undefined (degraded mode)', () => {
    expect(checkForwardLoop('https://peekhook.dev/i/abc', null)).toEqual({ ok: true })
    expect(checkForwardLoop('https://peekhook.dev/i/abc', '')).toEqual({ ok: true })
    expect(checkForwardLoop('https://peekhook.dev/i/abc', undefined)).toEqual({ ok: true })
  })

  it('flags a forward target whose origin matches and path starts with /i/', () => {
    const r = checkForwardLoop(`${INGEST}/i/abc/token`, INGEST)
    expect(r.ok).toBe(false)
    expect(r.reason).toBe('loop')
    expect(r.message).toMatch(/recurs/)
  })

  it('flags a forward target with a query string under /i/', () => {
    expect(checkForwardLoop(`${INGEST}/i/abc/token?x=1`, INGEST).ok).toBe(false)
  })

  it('does NOT flag a forward target on the same origin with a different path', () => {
    expect(checkForwardLoop(`${INGEST}/api/anything`, INGEST).ok).toBe(true)
    expect(checkForwardLoop(`${INGEST}/healthz`, INGEST).ok).toBe(true)
    expect(checkForwardLoop(`${INGEST}/`, INGEST).ok).toBe(true)
  })

  it('does NOT flag a forward target on a different origin (typical dev case)', () => {
    expect(checkForwardLoop('http://localhost:3000/webhook', INGEST).ok).toBe(true)
    expect(checkForwardLoop('http://127.0.0.1:3001/hook', INGEST).ok).toBe(true)
    expect(checkForwardLoop('https://example.com/i/some', INGEST).ok).toBe(true)
  })

  it('does NOT flag when either URL is unparseable (syntax errors are someone else’s job)', () => {
    expect(checkForwardLoop('not a url', INGEST).ok).toBe(true)
    expect(checkForwardLoop(`${INGEST}/i/abc`, 'not a url').ok).toBe(true)
  })

  it('compares origin strictly — different port is NOT the same origin', () => {
    expect(checkForwardLoop('http://peekhook.dev:3001/i/abc', 'http://peekhook.dev').ok).toBe(true)
  })

  it('compares origin strictly — different scheme is NOT the same origin', () => {
    expect(checkForwardLoop(`http://peekhook.dev/i/abc`, 'https://peekhook.dev').ok).toBe(true)
  })
})
