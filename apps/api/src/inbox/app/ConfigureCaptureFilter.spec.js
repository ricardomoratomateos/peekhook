import { describe, it, expect } from 'vitest'

import { ConfigureCaptureFilter } from './ConfigureCaptureFilter.js'
import { Outcome } from '../domain/Outcome.js'

function makeRepo(initial = null) {
  let stored = initial
  return {
    async findByToken(token) {
      return { token, captureFilter: stored }
    },
    async updateCaptureFilter(_token, value) {
      stored = value
    },
    get stored() { return stored },
  }
}

describe('ConfigureCaptureFilter', () => {
  it('returns NOT_FOUND when the inbox does not exist', async () => {
    const repo = { findByToken: async () => null, updateCaptureFilter: async () => {} }
    const sut = new ConfigureCaptureFilter({ inboxes: repo })
    const r = await sut.execute({ token: 'nope', captureFilter: { methods: ['POST'] } })
    expect(r.outcome).toBe(Outcome.NOT_FOUND)
  })

  it('returns INVALID on an unknown method', async () => {
    const repo = makeRepo()
    const sut = new ConfigureCaptureFilter({ inboxes: repo })
    const r = await sut.execute({ token: 't', captureFilter: { methods: ['FETCH'] } })
    expect(r.outcome).toBe(Outcome.INVALID)
    expect(repo.stored).toBe(null)
  })

  it('normalises and stores a valid filter', async () => {
    const repo = makeRepo()
    const sut = new ConfigureCaptureFilter({ inboxes: repo })
    const r = await sut.execute({
      token: 't',
      captureFilter: { methods: ['post'], paths: ['/webhooks/*'], headers: [{ name: 'X-Sig', value: '' }] },
    })
    expect(r.outcome).toBe(Outcome.UPDATED)
    expect(r.captureFilter.methods).toEqual(['POST'])
    expect(r.captureFilter.paths).toEqual(['/webhooks/*'])
    // empty value is dropped -> presence-only rule
    expect(r.captureFilter.headers).toEqual([{ name: 'X-Sig' }])
    expect(repo.stored).toEqual(r.captureFilter)
  })

  it('CLEARED when the filter is null', async () => {
    const repo = makeRepo({ methods: ['POST'] })
    const sut = new ConfigureCaptureFilter({ inboxes: repo })
    const r = await sut.execute({ token: 't', captureFilter: null })
    expect(r.outcome).toBe(Outcome.CLEARED)
    expect(repo.stored).toBe(null)
  })

  it('CLEARED when all dimensions are empty (normalises to null)', async () => {
    const repo = makeRepo({ methods: ['POST'] })
    const sut = new ConfigureCaptureFilter({ inboxes: repo })
    const r = await sut.execute({ token: 't', captureFilter: { methods: [], paths: [] } })
    expect(r.outcome).toBe(Outcome.CLEARED)
    expect(repo.stored).toBe(null)
  })
})
