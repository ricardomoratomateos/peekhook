import { describe, it, expect } from 'vitest'
import { Fixture } from './Fixture.js'

describe('Fixture', () => {
  const valid = {
    id:       'stripe.payment_intent.succeeded',
    name:     'Stripe — payment_intent.succeeded',
    provider: 'stripe',
    label:    'Stripe · payment succeeded',
    headers:  { 'content-type': 'application/json' },
    body:     '{"id":"evt_1"}',
  }

  it('accepts a complete, valid shape', () => {
    const f = Fixture.create(valid)
    expect(f.id).toBe(valid.id)
    expect(f.name).toBe(valid.name)
    expect(f.provider).toBe('stripe')
    expect(f.label).toBe(valid.label)
    expect(f.headers).toEqual(valid.headers)
    expect(f.body).toBe(valid.body)
  })

  it('bodySize reflects UTF-8 byte count, not character count', () => {
    const f = Fixture.create({ ...valid, body: '{"emoji":"\uD83D\uDE80"}' })
    // "rocket" emoji is 4 UTF-8 bytes; the four chars are: {"emoji":" = 11 chars
    // + the surrogate pair rendered as 2 chars by JS string length = 13 chars
    // but 15 bytes. Assert the byte count is what UI surfaces.
    expect(f.bodySize).toBe(Buffer.byteLength(f.body, 'utf8'))
    expect(f.bodySize).toBeGreaterThanOrEqual(13)
  })

  it('toListDto hides the body so listing endpoints stay light', () => {
    const f = Fixture.create(valid)
    expect(f.toListDto()).toEqual({
      id:        valid.id,
      name:      valid.name,
      provider:  'stripe',
      label:     valid.label,
      body_size: f.bodySize,
    })
    expect(f.toListDto()).not.toHaveProperty('body')
    expect(f.toListDto()).not.toHaveProperty('headers')
  })

  it('rejects an empty id', () => {
    expect(() => Fixture.create({ ...valid, id: '' })).toThrow(/id must be a non-empty string/)
  })

  it('rejects a non-string provider', () => {
    expect(() => Fixture.create({ ...valid, provider: 42 })).toThrow(/provider must be a non-empty string/)
  })

  it('rejects an empty label', () => {
    expect(() => Fixture.create({ ...valid, label: '' })).toThrow(/label must be a non-empty string/)
  })

  it('rejects headers that are not a plain object', () => {
    expect(() => Fixture.create({ ...valid, headers: ['content-type'] }))
      .toThrow(/headers must be a plain object/)
    expect(() => Fixture.create({ ...valid, headers: null }))
      .toThrow(/headers must be a plain object/)
  })

  it('rejects a body that is not a string', () => {
    expect(() => Fixture.create({ ...valid, body: { foo: 'bar' } }))
      .toThrow(/body must be a string/)
    expect(() => Fixture.create({ ...valid, body: undefined }))
      .toThrow(/body must be a string/)
  })
})
