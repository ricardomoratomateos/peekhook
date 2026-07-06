import { describe, it, expect } from 'vitest'
import { SendFixture } from './SendFixture.js'
import { Fixture } from '../domain/Fixture.js'

function buildFixturesRepo(seed) {
  const byId = new Map(seed.map((f) => [f.id, f]))
  return {
    async listAll()   { return [...byId.values()] },
    async findById(id) { return byId.get(id) ?? null },
  }
}

function buildCaptureRequestFake({ inboxOutcome = 'captured', id = 'fake-id-1', responseConfig = null } = {}) {
  const calls = []
  return {
    calls,
    async execute(cmd) {
      calls.push(cmd)
      return { outcome: inboxOutcome, id, responseConfig }
    },
  }
}

function fixture(props) {
  return Fixture.create({
    id:       props.id,
    name:     props.name ?? 'Sample · demo',
    provider: props.provider ?? 'demo',
    label:    props.label ?? 'demo',
    headers:  props.headers ?? { 'content-type': 'application/json' },
    body:     props.body    ?? '{"event":"test"}',
  })
}

describe('SendFixture', () => {
  it('returns fixture_not_found when the requested id is not in the catalogue', async () => {
    const repo  = buildFixturesRepo([])
    const cr    = buildCaptureRequestFake()
    const sut   = new SendFixture({ fixtures: repo, captureRequest: cr })

    const result = await sut.execute({ inboxToken: 'tok', fixtureId: 'nope.nothing' })

    expect(result).toEqual({ outcome: 'fixture_not_found' })
    expect(cr.calls).toHaveLength(0)
  })

  it('threads fixture headers and body into the CaptureRequest call verbatim', async () => {
    const f = fixture({
      id:      'github.push',
      headers: {
        'content-type':   'application/json',
        'x-github-event': 'push',
        'user-agent':     'GitHub-Hookshot/demo',
      },
      body: '{"ref":"refs/heads/main","commits":[]}',
    })
    const repo = buildFixturesRepo([f])
    const cr   = buildCaptureRequestFake({ id: 'newid-7' })
    const sut  = new SendFixture({ fixtures: repo, captureRequest: cr })

    const result = await sut.execute({ inboxToken: 'tok', fixtureId: 'github.push' })

    expect(cr.calls).toHaveLength(1)
    const sent = cr.calls[0]
    expect(sent.inboxToken).toBe('tok')
    expect(sent.method).toBe('POST')
    expect(sent.path).toBe('/i/tok')
    expect(sent.query).toEqual({})
    expect(sent.headers).toEqual({
      'content-type':   'application/json',
      'x-github-event': 'push',
      'user-agent':     'GitHub-Hookshot/demo',
    })
    expect(sent.body).toBe(f.body)
    expect(sent.contentType).toBe('application/json')
    expect(sent.size).toBe(f.bodySize)
    expect(sent.ip).toBe('127.0.0.1')
    expect(result).toEqual({ outcome: 'sent', eventId: 'newid-7' })
  })

  it('propagates inbox_not_found from the CaptureRequest pipeline', async () => {
    const f = fixture({ id: 'generic.webhook_test' })
    const repo = buildFixturesRepo([f])
    const cr   = buildCaptureRequestFake({ inboxOutcome: 'inbox_not_found' })
    const sut  = new SendFixture({ fixtures: repo, captureRequest: cr })

    const result = await sut.execute({ inboxToken: 'no-such', fixtureId: 'generic.webhook_test' })

    expect(result).toEqual({ outcome: 'inbox_not_found' })
  })

  it('handles fixtures with no content-type header (contentType falls back to "")', async () => {
    const f = fixture({
      id:      'no.ctype',
      headers: { 'x-custom': 'value' },
      body:    'plain text body',
    })
    const repo = buildFixturesRepo([f])
    const cr   = buildCaptureRequestFake()
    const sut  = new SendFixture({ fixtures: repo, captureRequest: cr })

    await sut.execute({ inboxToken: 'tok', fixtureId: 'no.ctype' })

    expect(cr.calls[0].contentType).toBe('')
    expect(cr.calls[0].headers['x-custom']).toBe('value')
    expect(cr.calls[0].body).toBe('plain text body')
  })

  it('rejects an empty inboxToken', async () => {
    const sut = new SendFixture({
      fixtures:       buildFixturesRepo([]),
      captureRequest: buildCaptureRequestFake(),
    })
    await expect(sut.execute({ inboxToken: '', fixtureId: 'x.y' }))
      .rejects.toThrow(/inboxToken required/)
  })

  it('rejects an empty fixtureId', async () => {
    const sut = new SendFixture({
      fixtures:       buildFixturesRepo([]),
      captureRequest: buildCaptureRequestFake(),
    })
    await expect(sut.execute({ inboxToken: 't', fixtureId: '' }))
      .rejects.toThrow(/fixtureId required/)
  })

  it('discards any responseConfig so the HTTP layer sends the standard { ok, eventId }', async () => {
    const f = fixture({ id: 'a.b' })
    const repo = buildFixturesRepo([f])
    const cr   = buildCaptureRequestFake({
      id: 'cap-1',
      responseConfig: { enabled: true, status: 503, contentType: 'text/plain', body: 'busy' },
    })
    const sut  = new SendFixture({ fixtures: repo, captureRequest: cr })

    const result = await sut.execute({ inboxToken: 'tok', fixtureId: 'a.b' })

    expect(result).toEqual({ outcome: 'sent', eventId: 'cap-1' })
    expect(result).not.toHaveProperty('responseConfig')
  })
})
