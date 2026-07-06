import { describe, it, expect } from 'vitest'
import { ListFixtures } from './ListFixtures.js'
import { Fixture } from '../domain/Fixture.js'

function buildRepo(seed) {
  return {
    fixtures: seed,
    async listAll() { return this.fixtures },
  }
}

function fixture(props) {
  return Fixture.create({
    id:       props.id,
    name:     props.name ?? 'Sample · demo',
    provider: props.provider ?? 'demo',
    label:    props.label ?? 'demo',
    headers:  { 'content-type': 'application/json' },
    body:     props.body ?? '{"hello":"world"}',
  })
}

describe('ListFixtures', () => {
  it('returns the listing DTO for each fixture, in repo order', async () => {
    const a = fixture({ id: 'a.one', body: '{"a":1}' })
    const b = fixture({ id: 'b.two', body: '[1,2,3,4,5]' })
    const repo = buildRepo([a, b])

    const sut = new ListFixtures({ fixtures: repo })
    const out = await sut.execute()

    expect(out).toEqual([
      { id: 'a.one', name: 'Sample · demo', provider: 'demo', label: 'demo', body_size: a.bodySize },
      { id: 'b.two', name: 'Sample · demo', provider: 'demo', label: 'demo', body_size: b.bodySize },
    ])
  })

  it('returns an empty array (not null) when the repository has no fixtures', async () => {
    const repo = buildRepo([])
    const sut = new ListFixtures({ fixtures: repo })
    expect(await sut.execute()).toEqual([])
  })

  it('omits the body and headers from the listing DTO', async () => {
    const f = fixture({ id: 'private.body', body: '{"secret":"do-not-leak"}' })
    const repo = buildRepo([f])
    const sut = new ListFixtures({ fixtures: repo })

    const [row] = await sut.execute()
    expect(row).not.toHaveProperty('body')
    expect(row).not.toHaveProperty('headers')
    expect(row.body_size).toBe(f.bodySize)
  })
})
