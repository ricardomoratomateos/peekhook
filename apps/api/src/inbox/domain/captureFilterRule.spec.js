import { describe, it, expect } from 'vitest'
import { matchesCaptureFilter, matchGlob } from './captureFilterRule.js'

const req = (over = {}) => ({
  method: 'POST',
  path: '/webhooks/stripe',
  query: {},
  headers: { 'content-type': 'application/json' },
  ...over,
})

describe('matchesCaptureFilter', () => {
  it('captures everything when the filter is null/empty', () => {
    expect(matchesCaptureFilter(req(), null)).toBe(true)
    expect(matchesCaptureFilter(req(), undefined)).toBe(true)
    expect(matchesCaptureFilter(req(), {})).toBe(true)
  })

  it('methods: case-insensitive allowlist', () => {
    expect(matchesCaptureFilter(req({ method: 'POST' }), { methods: ['post'] })).toBe(true)
    expect(matchesCaptureFilter(req({ method: 'GET' }), { methods: ['POST', 'PUT'] })).toBe(false)
  })

  it('paths: exact and glob', () => {
    expect(matchesCaptureFilter(req({ path: '/webhooks/stripe' }), { paths: ['/webhooks/stripe'] })).toBe(true)
    expect(matchesCaptureFilter(req({ path: '/webhooks/stripe' }), { paths: ['/webhooks/paypal'] })).toBe(false)
    expect(matchesCaptureFilter(req({ path: '/api/users/42' }), { paths: ['/api/*'] })).toBe(true)
    expect(matchesCaptureFilter(req({ path: '/other/x' }), { paths: ['/api/*'] })).toBe(false)
  })

  it('OR within a dimension: any path matches', () => {
    const f = { paths: ['/a', '/b'] }
    expect(matchesCaptureFilter(req({ path: '/b' }), f)).toBe(true)
    expect(matchesCaptureFilter(req({ path: '/c' }), f)).toBe(false)
  })

  it('AND across dimensions: all must match', () => {
    const f = { methods: ['POST'], paths: ['/webhooks/*'] }
    expect(matchesCaptureFilter(req({ method: 'POST', path: '/webhooks/x' }), f)).toBe(true)
    expect(matchesCaptureFilter(req({ method: 'GET', path: '/webhooks/x' }), f)).toBe(false)
    expect(matchesCaptureFilter(req({ method: 'POST', path: '/nope' }), f)).toBe(false)
  })

  it('headers: presence and value, case-insensitive name', () => {
    const present = { headers: [{ name: 'X-Event-Type' }] }
    expect(matchesCaptureFilter(req({ headers: { 'x-event-type': 'payment' } }), present)).toBe(true)
    expect(matchesCaptureFilter(req({ headers: {} }), present)).toBe(false)

    const valued = { headers: [{ name: 'x-event-type', value: 'payment' }] }
    expect(matchesCaptureFilter(req({ headers: { 'x-event-type': 'payment' } }), valued)).toBe(true)
    expect(matchesCaptureFilter(req({ headers: { 'x-event-type': 'refund' } }), valued)).toBe(false)
  })

  it('query: presence and value, case-sensitive name', () => {
    const f = { query: [{ name: 'type', value: 'payment' }] }
    expect(matchesCaptureFilter(req({ query: { type: 'payment' } }), f)).toBe(true)
    expect(matchesCaptureFilter(req({ query: { type: 'refund' } }), f)).toBe(false)
    // case-sensitive key: Type !== type
    expect(matchesCaptureFilter(req({ query: { Type: 'payment' } }), f)).toBe(false)
  })

  it('matches array-valued headers/query (repeated keys)', () => {
    const f = { query: [{ name: 'tag', value: 'b' }] }
    expect(matchesCaptureFilter(req({ query: { tag: ['a', 'b'] } }), f)).toBe(true)
  })
})

describe('matchGlob', () => {
  it('treats * as a wildcard and escapes regex metachars', () => {
    expect(matchGlob('/api/v1.0/x', '/api/v1.0/*')).toBe(true)
    expect(matchGlob('/api/v1X0/x', '/api/v1.0/*')).toBe(false) // dot is literal
    expect(matchGlob('/exact', '/exact')).toBe(true)
    expect(matchGlob('/exact/more', '/exact')).toBe(false) // anchored
  })
})
