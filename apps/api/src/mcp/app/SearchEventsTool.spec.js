import { describe, it, expect } from 'vitest'
import { RequestSearchReadModel } from '../domain/RequestSearchReadModel.js'
import { SearchEventsTool } from './SearchEventsTool.js'

/**
 * In-memory fake port that mirrors MongoRequestSearchReadModel's
 * filtering semantics: for each record, evaluate the regex against
 * the field the caller chose.
 */
class FakeSearchModel extends RequestSearchReadModel {
  constructor() { super(); this.calls = []; this.records = [] }
  async search({ inboxToken, regex, field, headerKey, limit }) {
    this.calls.push({ inboxToken, regex, field, headerKey, limit })
    const re = new RegExp(regex, 'i')
    return this.records.filter((r) => {
      if (r.inboxToken !== inboxToken) return false
      if (field === 'path')   return re.test(r.path ?? '')
      if (field === 'header') return typeof headerKey === 'string'
        && re.test(String(r.headers?.[headerKey] ?? ''))
      if (field === 'body')   return re.test(r.body ?? '')
      return false
    })
  }
}

const records = [
  { id: 'r1', inboxToken: 'inb_x', path: '/webhooks/stripe',
    headers: { 'x-signature': 'abc', 'x-github-event': 'push' },
    body: '{"event":"created"}' },
  { id: 'r2', inboxToken: 'inb_x', path: '/webhooks/github',
    headers: { 'x-github-event': 'push' },
    body: '{"ref":"main"}' },
  { id: 'r3', inboxToken: 'inb_x', path: '/other',
    headers: { 'x-signature': 'xyz' },
    body: 'plain text body' },
  { id: 'r4', inboxToken: 'inb_y', path: '/webhooks/stripe',
    headers: {}, body: '{}' },
]

describe('SearchEventsTool', () => {
  it('finds events by path regex', async () => {
    const fake = new FakeSearchModel()
    fake.records = records
    const sut = new SearchEventsTool({ readModel: fake })

    const result = await sut.execute({ inbox_token: 'inb_x', regex: 'stripe', field: 'path' })
    expect(result.events.map((r) => r.id)).toEqual(['r1'])
    expect(fake.calls[0].regex).toBe('stripe')
    expect(fake.calls[0].field).toBe('path')
    expect(fake.calls[0].inboxToken).toBe('inb_x')
  })

  it('finds events by header regex with header_key', async () => {
    const fake = new FakeSearchModel()
    fake.records = records
    const sut = new SearchEventsTool({ readModel: fake })

    const result = await sut.execute({
      inbox_token: 'inb_x',
      regex: 'push',
      field: 'header',
      header_key: 'x-github-event',
    })
    expect(result.events.map((r) => r.id)).toEqual(['r1', 'r2'])
  })

  it('finds events by body regex', async () => {
    const fake = new FakeSearchModel()
    fake.records = records
    const sut = new SearchEventsTool({ readModel: fake })

    const result = await sut.execute({ inbox_token: 'inb_x', regex: 'plain', field: 'body' })
    expect(result.events.map((r) => r.id)).toEqual(['r3'])
  })

  it('returns empty when nothing matches', async () => {
    const fake = new FakeSearchModel()
    fake.records = records
    const sut = new SearchEventsTool({ readModel: fake })

    expect((await sut.execute({ inbox_token: 'inb_x', regex: 'nothing', field: 'path' })).events).toEqual([])
  })

  it('escapes regex metacharacters so they are treated as literals', async () => {
    const fake = new FakeSearchModel()
    fake.records = [
      { id: 'rA', inboxToken: 'inb_x', path: '/foo.git', headers: {}, body: '' },
      { id: 'rB', inboxToken: 'inb_x', path: '/fooXgit', headers: {}, body: '' },
    ]
    const sut = new SearchEventsTool({ readModel: fake })

    // `.git` raw would otherwise match any single char before `git` —
    // both records would qualify. Escaping restricts to literal `.git`.
    const result = await sut.execute({ inbox_token: 'inb_x', regex: '.git', field: 'path' })
    expect(result.events.map((r) => r.id)).toEqual(['rA'])
    expect(fake.calls[0].regex).toBe('\\.git')
  })

  it('throws when regex is missing', async () => {
    const sut = new SearchEventsTool({ readModel: new FakeSearchModel() })
    await expect(() => sut.execute({ inbox_token: 'inb_x' })).rejects.toThrow(/regex/)
  })

  it('throws when field is header without header_key', async () => {
    const fake = new FakeSearchModel()
    fake.records = records
    const sut = new SearchEventsTool({ readModel: fake })
    await expect(() => sut.execute({
      inbox_token: 'inb_x', regex: 'push', field: 'header',
    })).rejects.toThrow(/headerKey|header_key/)
  })
})
