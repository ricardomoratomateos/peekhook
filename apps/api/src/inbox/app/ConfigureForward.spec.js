import { describe, it, expect } from 'vitest'

import { ConfigureForward } from './ConfigureForward.js'
import { Outcome } from '../domain/Outcome.js'

const INGEST = 'https://peekhook.example'

function makeRepo(initial = null) {
  let stored = initial
  return {
    async findByToken(token) {
      return { token, forwardTo: stored }
    },
    async updateForwardTo(_token, value) {
      stored = value
    },
    get stored() { return stored },
  }
}

describe('ConfigureForward', () => {
  it('returns NOT_FOUND when the inbox does not exist', async () => {
    const repo = {
      findByToken: async () => null,
      updateForwardTo: async () => {},
    }
    const sut = new ConfigureForward({ inboxes: repo, ingestUrl: INGEST })
    const r = await sut.execute({ token: 'nope', forwardTo: 'http://localhost:3001/x' })
    expect(r.outcome).toBe(Outcome.NOT_FOUND)
  })

  it('returns INVALID on a syntactically bad URL (legacy validateForwardUrl)', async () => {
    const repo = makeRepo()
    const sut = new ConfigureForward({ inboxes: repo, ingestUrl: INGEST })
    const r = await sut.execute({ token: 't', forwardTo: 'not a url' })
    expect(r.outcome).toBe(Outcome.INVALID)
    expect(r.error).toMatch(/valid http\(s\) URL/)
  })

  it('returns INVALID on a URL that would loop back into the ingest origin /i/', async () => {
    const repo = makeRepo()
    const sut = new ConfigureForward({ inboxes: repo, ingestUrl: INGEST })
    const r = await sut.execute({
      token: 't',
      forwardTo: `${INGEST}/i/abc`,
    })
    expect(r.outcome).toBe(Outcome.INVALID)
    expect(r.error).toMatch(/recurs/)
    expect(repo.stored).toBe(null) // unchanged
  })

  it('accepts a non-loop forward target (typical localhost case)', async () => {
    const repo = makeRepo()
    const sut = new ConfigureForward({ inboxes: repo, ingestUrl: INGEST })
    const r = await sut.execute({
      token: 't',
      forwardTo: 'http://localhost:3001/hook',
    })
    expect(r.outcome).toBe(Outcome.UPDATED)
    expect(r.forwardTo).toBe('http://localhost:3001/hook')
    expect(repo.stored).toBe('http://localhost:3001/hook')
  })

  it('clears the forward target when forwardTo is null', async () => {
    const repo = makeRepo('http://localhost:3001/hook')
    const sut = new ConfigureForward({ inboxes: repo, ingestUrl: INGEST })
    const r = await sut.execute({ token: 't', forwardTo: null })
    expect(r.outcome).toBe(Outcome.CLEARED)
    expect(r.forwardTo).toBe(null)
    expect(repo.stored).toBe(null)
  })
})
