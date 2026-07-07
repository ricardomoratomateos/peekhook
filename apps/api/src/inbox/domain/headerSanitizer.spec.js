import { describe, it, expect } from 'vitest'
import { sanitizeHeaders } from './headerSanitizer.js'

describe('sanitizeHeaders', () => {
  it('passes through safe headers untouched', () => {
    const headers = {
      'content-type': 'application/json',
      'x-webhook-token': 'whsec_AbCdEfGh123456',
      'user-agent': 'curl/8.0.1',
    }
    const out = sanitizeHeaders(headers)
    expect(out.sanitized).toEqual(headers)
    expect(out.stripped).toBe(false)
  })

  it('strips NUL bytes (\\u0000)', () => {
    const out = sanitizeHeaders({ 'x-evil': 'a\u0000b' })
    expect(out.sanitized['x-evil']).toBe('ab')
    expect(out.stripped).toBe(true)
  })

  it('strips the right-to-left override character (\\u202E)', () => {
    const out = sanitizeHeaders({ 'x-filename': 'invoice\u202Epdf.exe' })
    expect(out.sanitized['x-filename']).toBe('invoicepdf.exe')
    expect(out.stripped).toBe(true)
  })

  it('strips the full bidi override range (\\u202A-\\u202E and \\u2066-\\u2069)', () => {
    for (const ch of ['\u202A', '\u202B', '\u202C', '\u202D', '\u202E', '\u2066', '\u2067', '\u2068', '\u2069']) {
      const out = sanitizeHeaders({ 'x-bidi': `a${ch}b` })
      expect(out.sanitized['x-bidi']).toBe('ab')
    }
  })

  it('strips C0 control bytes except TAB (\\u0009)', () => {
    // Strip set covers \u0000-\u0008, \u000B-\u001F, \u007F — so the FF
    // (\u000C) and VT (\u000B) below are both in \u000B-\u001F.
    const out = sanitizeHeaders({ 'x-ctl': 'a\u0001\u0002\u0007\u000B\u000Cb\u007Fc' })
    expect(out.sanitized['x-ctl']).toBe('abc')
    expect(out.stripped).toBe(true)
  })

  it('preserves TAB (\\u0009) in header values', () => {
    const out = sanitizeHeaders({ 'x-tabbed': 'a\tb' })
    expect(out.sanitized['x-tabbed']).toBe('a\tb')
    expect(out.stripped).toBe(false)
  })

  it('handles a Fastify-style array-valued header', () => {
    const out = sanitizeHeaders({ 'x-set-cookie': ['a\u0000b', 'plain'] })
    expect(out.sanitized['x-set-cookie']).toEqual(['ab', 'plain'])
    expect(out.stripped).toBe(true)
  })

  it('returns {} with stripped=false on a null input', () => {
    const out = sanitizeHeaders(null)
    expect(out.sanitized).toEqual({})
    expect(out.stripped).toBe(false)
  })

  it('does not allocate a new object when no characters match', () => {
    const headers = { 'content-type': 'application/json', 'user-agent': 'curl/8.0.1' }
    const out = sanitizeHeaders(headers)
    expect(out.stripped).toBe(false)
    expect(out.sanitized).toBe(headers) // same reference (no copy needed)
  })

  it('strips a long sweep of unsafe characters without leaving any behind', () => {
    const dirty = '\u0000\u0001\u202E\u202D\u2067\u2068\u2069\thello'
    const out = sanitizeHeaders({ 'x': dirty })
    expect(out.sanitized['x']).toBe('\thello')
  })
})
