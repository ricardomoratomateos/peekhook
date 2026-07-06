import { describe, it, expect } from 'vitest'
import { diffBodies, diffHeaders, diffChars } from './diff.js'

describe('diffBodies', () => {
  it('returns empty added/removed when strings are identical', () => {
    const r = diffBodies('hello\nworld', 'hello\nworld')
    expect(r.added).toEqual([])
    expect(r.removed).toEqual([])
    expect(r.common).toEqual(['hello', 'world'])
  })

  it('treats two empty strings as a single common empty line', () => {
    const r = diffBodies('', '')
    expect(r.added).toEqual([])
    expect(r.removed).toEqual([])
    expect(r.common).toEqual([''])
  })

  it('flags lines present only in B as added (pure insert)', () => {
    const r = diffBodies('a\nc', 'a\nb\nc')
    expect(r.added).toEqual(['b'])
    expect(r.removed).toEqual([])
    expect(r.common).toEqual(['a', 'c'])
  })

  it('flags lines present only in A as removed (pure delete)', () => {
    const r = diffBodies('a\nb\nc', 'a\nc')
    expect(r.removed).toEqual(['b'])
    expect(r.added).toEqual([])
    expect(r.common).toEqual(['a', 'c'])
  })

  it('produces both added and removed for mixed diff', () => {
    const r = diffBodies('one\ntwo\nthree', 'one\nTWO\nthree')
    expect(r.removed).toEqual(['two'])
    expect(r.added).toEqual(['TWO'])
    expect(r.common).toEqual(['one', 'three'])
  })

  it('coerces non-string inputs to strings via String()', () => {
    const r = diffBodies(123, '123')
    expect(r.removed).toEqual([])
    expect(r.added).toEqual([])
    expect(r.common).toEqual(['123'])
  })

  it('treats null inputs as empty strings', () => {
    const r = diffBodies(null, null)
    expect(r.added).toEqual([])
    expect(r.removed).toEqual([])
    expect(r.common).toEqual([''])
  })

  it('produces ops array that aligns common lines between a and b', () => {
    const r = diffBodies('a\nb', 'a\nc')
    const commonCount = r.ops.filter(o => o.type === 'common').length
    expect(commonCount).toBe(1)
  })
})

describe('diffHeaders', () => {
  it('returns all-unchanged for identical headers', () => {
    const h = { 'content-type': 'application/json', 'x-foo': 'bar' }
    const r = diffHeaders(h, { ...h })
    expect(r.added).toEqual([])
    expect(r.removed).toEqual([])
    expect(r.changed).toEqual([])
    expect(r.unchanged).toEqual([
      { key: 'content-type', value: 'application/json' },
      { key: 'x-foo', value: 'bar' },
    ])
  })

  it('flags headers only in B as added', () => {
    const r = diffHeaders({ a: '1' }, { a: '1', b: '2' })
    expect(r.added).toEqual([{ key: 'b', value: '2' }])
    expect(r.removed).toEqual([])
    expect(r.changed).toEqual([])
  })

  it('flags headers only in A as removed', () => {
    const r = diffHeaders({ a: '1', b: '2' }, { a: '1' })
    expect(r.removed).toEqual([{ key: 'b', value: '2' }])
    expect(r.added).toEqual([])
    expect(r.changed).toEqual([])
  })

  it('flags headers with same key but different value as changed', () => {
    const r = diffHeaders({ 'x-token': 'old' }, { 'x-token': 'new' })
    expect(r.changed).toEqual([{ key: 'x-token', a: 'old', b: 'new' }])
    expect(r.unchanged).toEqual([])
  })

  it('treats array-valued headers as equal when contents match', () => {
    const r = diffHeaders({ accept: ['a', 'b'] }, { accept: ['a', 'b'] })
    expect(r.changed).toEqual([])
    expect(r.unchanged).toEqual([{ key: 'accept', value: ['a', 'b'] }])
  })

  it('treats array-valued headers as changed when contents differ', () => {
    const r = diffHeaders({ accept: ['a', 'b'] }, { accept: ['a', 'c'] })
    expect(r.changed).toEqual([{ key: 'accept', a: ['a', 'b'], b: ['a', 'c'] }])
  })

  it('handles missing or non-object inputs safely', () => {
    expect(diffHeaders(null, null)).toEqual({ added: [], removed: [], changed: [], unchanged: [] })
    const r = diffHeaders(undefined, { 'x-foo': '1' })
    expect(r.added).toEqual([{ key: 'x-foo', value: '1' }])
  })
})

describe('diffChars', () => {
  it('returns a single equal segment when inputs match', () => {
    expect(diffChars('hello', 'hello')).toEqual([{ type: 'eq', text: 'hello' }])
  })

  it('returns an insert when a is empty', () => {
    expect(diffChars('', 'abc')).toEqual([{ type: 'ins', text: 'abc' }])
  })

  it('returns a delete when b is empty', () => {
    expect(diffChars('abc', '')).toEqual([{ type: 'del', text: 'abc' }])
  })

  it('returns del + ins when strings differ entirely', () => {
    const r = diffChars('abc', 'xyz')
    expect(r).toEqual([{ type: 'del', text: 'abc' }, { type: 'ins', text: 'xyz' }])
  })

  it('returns common + del + ins for partial overlap', () => {
    const r = diffChars('hello world', 'hello there')
    const eq = r.find(x => x.type === 'eq')
    const del = r.find(x => x.type === 'del')
    const ins = r.find(x => x.type === 'ins')
    expect(eq.text).toContain('hello')
    expect(del.text).toContain('world')
    expect(ins.text).toContain('there')
  })

  it('coalesces consecutive segments of the same type', () => {
    const r = diffChars('abc', 'aBc')
    expect(r.filter(s => s.type === 'eq').length).toBe(1)
  })
})