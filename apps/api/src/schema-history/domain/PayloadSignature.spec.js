import { describe, it, expect } from 'vitest'
import { signatureOf, walk } from './PayloadSignature.js'

describe('PayloadSignature.signatureOf', () => {
  it('returns a single root entry for a scalar body', () => {
    expect(signatureOf('"hello"')).toEqual([{ path: '', type: 'string' }])
    expect(signatureOf('42')).toEqual([{ path: '', type: 'number' }])
    expect(signatureOf('true')).toEqual([{ path: '', type: 'boolean' }])
    expect(signatureOf('null')).toEqual([{ path: '', type: 'null' }])
  })

  it('treats an empty root object as a single object entry at path ""', () => {
    expect(signatureOf('{}')).toEqual([{ path: '', type: 'object' }])
  })

  it('returns a single object entry for a nested empty object leaf', () => {
    expect(signatureOf('{"a":{}}')).toEqual([{ path: 'a', type: 'object' }])
    expect(signatureOf('{"a":{"b":{}}}')).toEqual([{ path: 'a.b', type: 'object' }])
  })

  it('returns one entry per top-level field for a flat object', () => {
    expect(signatureOf('{"a":1,"b":"x"}')).toEqual([
      { path: 'a', type: 'number' },
      { path: 'b', type: 'string' },
    ])
  })

  it('joins nested object keys with "." and recurses', () => {
    expect(signatureOf('{"a":{"b":{"c":1}},"d":2}')).toEqual([
      { path: 'a.b.c', type: 'number' },
      { path: 'd', type: 'number' },
    ])
  })

  it('records an array at any path as a single "array" entry with no element walk', () => {
    expect(signatureOf('[1,2,3]')).toEqual([{ path: '', type: 'array' }])
    expect(signatureOf('{"a":[1,2,3]}')).toEqual([{ path: 'a', type: 'array' }])
    expect(signatureOf('{"a":{"b":[true,false,null]}}')).toEqual([
      { path: 'a.b', type: 'array' },
    ])
  })

  it('throws a "body: invalid JSON" error on malformed input', () => {
    expect(() => signatureOf('not json')).toThrow(/body: invalid JSON/)
    expect(() => signatureOf('{')).toThrow(/body: invalid JSON/)
    expect(() => signatureOf('')).toThrow(/body: invalid JSON/)
  })

  it('walks mixed-type payloads in insertion order', () => {
    const entries = signatureOf('{"event":"created","count":3,"ok":true,"meta":null}')
    expect(entries).toEqual([
      { path: 'event', type: 'string' },
      { path: 'count', type: 'number' },
      { path: 'ok',    type: 'boolean' },
      { path: 'meta',  type: 'null' },
    ])
  })
})

describe('PayloadSignature.walk', () => {
  it('accepts a pre-parsed value without re-parsing', () => {
    expect(walk({ a: 1 }, '')).toEqual([{ path: 'a', type: 'number' }])
    expect(walk([1, 2], '')).toEqual([{ path: '', type: 'array' }])
  })

  it('handles null at root', () => {
    expect(walk(null, '')).toEqual([{ path: '', type: 'null' }])
  })
})
