import { describe, it, expect } from 'vitest'
import { SearchEvents } from './SearchEvents.js'
import { SearchEventsRepository } from '../domain/SearchEventsRepository.js'

class FakeSearchRepo extends SearchEventsRepository {
  constructor() { super(); this.calls = []; this.response = [] }
  async search(query) {
    this.calls.push(query)
    return this.response
  }
}

describe('SearchEvents (use case)', () => {
  it('forwards a valid regex and field="path" to the repository and returns its DTO list', async () => {
    const fake = new FakeSearchRepo()
    fake.response = [{ id: 'r1' }, { id: 'r2' }]
    const sut = new SearchEvents({ repo: fake })

    const result = await sut.execute({
      inboxToken: 'inb_x',
      regex:      'stripe',
      field:      'path',
    })

    expect(result).toEqual([{ id: 'r1' }, { id: 'r2' }])
    expect(fake.calls).toHaveLength(1)
    expect(fake.calls[0].inboxToken).toBe('inb_x')
    expect(fake.calls[0].regex).toBe('stripe')
    expect(fake.calls[0].field).toEqual({ kind: 'path', name: null })
    expect(fake.calls[0].before).toBeUndefined()
  })

  it('returns an empty list (no throw, no repo call) when the regex is an empty string', async () => {
    const fake = new FakeSearchRepo()
    const sut  = new SearchEvents({ repo: fake })

    const result = await sut.execute({
      inboxToken: 'inb_x',
      regex:      '',
      field:      'path',
    })

    expect(result).toEqual([])
    expect(fake.calls).toHaveLength(0)
  })

  it('treats whitespace-only regex as empty and short-circuits to []', async () => {
    const fake = new FakeSearchRepo()
    const sut  = new SearchEvents({ repo: fake })

    const result = await sut.execute({
      inboxToken: 'inb_x',
      regex:      '   ',
      field:      'path',
    })

    expect(result).toEqual([])
    expect(fake.calls).toHaveLength(0)
  })

  it('throws when the regex exceeds the 256-char cap', async () => {
    const fake = new FakeSearchRepo()
    const sut  = new SearchEvents({ repo: fake })

    const tooLong = 'a'.repeat(257)
    await expect(() => sut.execute({
      inboxToken: 'inb_x',
      regex:      tooLong,
      field:      'path',
    })).rejects.toThrow(/256/)
    expect(fake.calls).toHaveLength(0)
  })

  it('throws when the regex is not a string', async () => {
    const fake = new FakeSearchRepo()
    const sut  = new SearchEvents({ repo: fake })

    await expect(() => sut.execute({
      inboxToken: 'inb_x',
      regex:      undefined,
      field:      'path',
    })).rejects.toThrow(/regex/)
    await expect(() => sut.execute({
      inboxToken: 'inb_x',
      regex:      123,
      field:      'path',
    })).rejects.toThrow(/regex/)

    expect(fake.calls).toHaveLength(0)
  })

  it('throws when the regex does not compile in JavaScript', async () => {
    const fake = new FakeSearchRepo()
    const sut  = new SearchEvents({ repo: fake })

    // unbalanced group — `new RegExp(this)` throws
    await expect(() => sut.execute({
      inboxToken: 'inb_x',
      regex:      '(unclosed',
      field:      'path',
    })).rejects.toThrow(/valid regular expression/)
    expect(fake.calls).toHaveLength(0)
  })

  it('maps the "path" SearchField into the structured query {kind:"path"}', async () => {
    const fake = new FakeSearchRepo()
    const sut  = new SearchEvents({ repo: fake })

    await sut.execute({ inboxToken: 'inb_x', regex: 'x', field: 'path' })
    expect(fake.calls[0].field).toEqual({ kind: 'path', name: null })
  })

  it('maps the "body" SearchField into the structured query {kind:"body"}', async () => {
    const fake = new FakeSearchRepo()
    const sut  = new SearchEvents({ repo: fake })

    await sut.execute({ inboxToken: 'inb_x', regex: 'x', field: 'body' })
    expect(fake.calls[0].field).toEqual({ kind: 'body', name: null })
  })

  it('maps the "header:<name>" SearchField into {kind:"header", name:<name>}', async () => {
    const fake = new FakeSearchRepo()
    const sut  = new SearchEvents({ repo: fake })

    await sut.execute({ inboxToken: 'inb_x', regex: 'x', field: 'header:user-agent' })
    expect(fake.calls[0].field).toEqual({ kind: 'header', name: 'user-agent' })
  })

  it('throws when field is unknown', async () => {
    const fake = new FakeSearchRepo()
    const sut  = new SearchEvents({ repo: fake })

    await expect(() => sut.execute({
      inboxToken: 'inb_x',
      regex:      'x',
      field:      'method',
    })).rejects.toThrow(/field/)
    expect(fake.calls).toHaveLength(0)
  })

  it('throws when field is "header:" with no header name', async () => {
    const fake = new FakeSearchRepo()
    const sut  = new SearchEvents({ repo: fake })

    await expect(() => sut.execute({
      inboxToken: 'inb_x',
      regex:      'x',
      field:      'header:',
    })).rejects.toThrow(/header/)
    expect(fake.calls).toHaveLength(0)
  })

  it('passes 256-char regex exactly through (boundary)', async () => {
    const fake = new FakeSearchRepo()
    const sut  = new SearchEvents({ repo: fake })

    const exact = 'a'.repeat(256)
    await sut.execute({ inboxToken: 'inb_x', regex: exact, field: 'path' })
    expect(fake.calls).toHaveLength(1)
  })

  it('caps the limit at the 200 ceiling before hitting the repo', async () => {
    const fake = new FakeSearchRepo()
    const sut  = new SearchEvents({ repo: fake })

    await sut.execute({ inboxToken: 'inb_x', regex: 'x', field: 'path', limit: 9999 })
    expect(fake.calls[0].limit).toBe(200)
  })

  it('defaults the limit to 50 when not provided', async () => {
    const fake = new FakeSearchRepo()
    const sut  = new SearchEvents({ repo: fake })

    await sut.execute({ inboxToken: 'inb_x', regex: 'x', field: 'path' })
    expect(fake.calls[0].limit).toBe(50)
  })

  it('forwards the before cursor through to the repo', async () => {
    const fake = new FakeSearchRepo()
    const sut  = new SearchEvents({ repo: fake })

    await sut.execute({
      inboxToken: 'inb_x',
      regex:      'x',
      field:      'path',
      before:     '65fa11b3aa6c1f9d1c8dbe21',
    })
    expect(fake.calls[0].before).toBe('65fa11b3aa6c1f9d1c8dbe21')
  })
})
