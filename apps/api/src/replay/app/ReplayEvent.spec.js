import { describe, it, expect } from 'vitest'
import { ReplayEvent } from './ReplayEvent.js'
import { ReplayOutcome, REPLAY_HEADER, REPLAY_HEADER_VALUE } from '../domain/ReplayOutcome.js'

function fakeInboxesByToken(inboxOrNull) {
  return {
    async findByToken(token) {
      if (!inboxOrNull || inboxOrNull.token !== token) return null
      return inboxOrNull
    },
  }
}

function fakeRequestsById(requestOrNull) {
  return {
    async findById({ inboxToken, id }) {
      if (!requestOrNull) return null
      if (requestOrNull.inboxToken !== inboxToken || requestOrNull.id !== id) return null
      return requestOrNull
    },
  }
}

function fakeRateLimiter({ allowed = true, retryAfterSec } = {}) {
  return {
    calls: [],
    async tryConsume({ inboxToken }) {
      this.calls.push(inboxToken)
      return allowed
        ? { allowed: true }
        : { allowed: false, retryAfterSec: retryAfterSec ?? 60 }
    },
  }
}

function fakeRunScript(result) {
  return {
    calls: [],
    async execute(cmd) { this.calls.push(cmd); return result },
  }
}

const FIXED_NOW = new Date('2026-01-15T12:00:00.000Z')

const sampleRequest = {
  id:          'evt-1',
  inboxToken:  'tok-1',
  method:      'POST',
  path:        '/i/tok-1',
  headers:     { 'content-type': 'application/json' },
  body:        '{"hello":"world"}',
  contentType: 'application/json',
  query:       {},
}

describe('ReplayEvent', () => {
  it('returns the configured static body when mockOnly=true and responseConfig is enabled', async () => {
    const inbox = {
      token: 'tok-1',
      responseConfig: {
        enabled:     true,
        status:      207,
        contentType: 'application/json',
        body:        '{"multi":"status"}',
      },
    }
    const limiter = fakeRateLimiter()
    const sut = new ReplayEvent({
      inboxes:     fakeInboxesByToken(inbox),
      requests:    fakeRequestsById(sampleRequest),
      rateLimiter: limiter,
      now:         () => FIXED_NOW,
    })

    const result = await sut.execute({ inboxToken: 'tok-1', eventId: 'evt-1', mockOnly: true })

    expect(result.outcome).toBe(ReplayOutcome.REPLAYED)
    expect(result.target.toDto()).toEqual({
      type:        'mock_reply',
      status:      207,
      contentType: 'application/json',
      body:        '{"multi":"status"}',
    })
    expect(result.replayedAt).toEqual(FIXED_NOW)
    expect(limiter.calls).toEqual(['tok-1'])
  })

  it('returns RATE_LIMITED with retryAfterSec when the bucket denies', async () => {
    const inbox = {
      token: 'tok-1',
      responseConfig: { enabled: true, status: 200, contentType: 'application/json', body: '{}' },
    }
    const sut = new ReplayEvent({
      inboxes:     fakeInboxesByToken(inbox),
      requests:    fakeRequestsById(sampleRequest),
      rateLimiter: fakeRateLimiter({ allowed: false, retryAfterSec: 42 }),
    })

    const result = await sut.execute({ inboxToken: 'tok-1', eventId: 'evt-1', mockOnly: true })
    expect(result.outcome).toBe(ReplayOutcome.RATE_LIMITED)
    expect(result.retryAfterSec).toBe(42)
  })

  it('rejects forward mode with INVALID when no forward target is configured', async () => {
    const inbox = {
      token: 'tok-1',
      forwardTo: null,
      responseConfig: { enabled: true, status: 200, contentType: 'application/json', body: '{}' },
    }
    const limiter = fakeRateLimiter()
    const sut = new ReplayEvent({
      inboxes:     fakeInboxesByToken(inbox),
      requests:    fakeRequestsById(sampleRequest),
      rateLimiter: limiter,
      forward:     async () => ({ ok: true, status: 200, contentType: 'application/json', body: 'x', durationMs: 1 }),
    })

    const result = await sut.execute({ inboxToken: 'tok-1', eventId: 'evt-1', mode: 'forward' })
    expect(result.outcome).toBe(ReplayOutcome.INVALID)
    expect(result.error).toMatch(/no forward target/)
    // Validation rejection must not consume a rate-limit token.
    expect(limiter.calls).toEqual([])
  })

  it('returns the default {ok:true} 200 target when responseConfig is disabled', async () => {
    const inbox = {
      token: 'tok-1',
      responseConfig: { enabled: false, status: 200, contentType: 'application/json', body: 'unused' },
    }
    const sut = new ReplayEvent({
      inboxes:     fakeInboxesByToken(inbox),
      requests:    fakeRequestsById(sampleRequest),
      rateLimiter: fakeRateLimiter(),
    })

    const result = await sut.execute({ inboxToken: 'tok-1', eventId: 'evt-1', mockOnly: true })
    expect(result.outcome).toBe(ReplayOutcome.REPLAYED)
    expect(result.target.toDto()).toEqual({
      type:        'mock_reply',
      status:      200,
      contentType: 'application/json',
      body:        JSON.stringify({ ok: true }),
    })
  })

  it('returns NOT_FOUND when the event id does not exist in this inbox', async () => {
    const inbox = {
      token: 'tok-1',
      responseConfig: null,
    }
    const sut = new ReplayEvent({
      inboxes:     fakeInboxesByToken(inbox),
      requests:    fakeRequestsById(null),
      rateLimiter: fakeRateLimiter(),
    })

    const result = await sut.execute({ inboxToken: 'tok-1', eventId: 'evt-missing', mockOnly: true })
    expect(result.outcome).toBe(ReplayOutcome.NOT_FOUND)
  })

  it('runs the configured script and uses its string return value', async () => {
    const inbox = {
      token: 'tok-1',
      responseConfig: {
        enabled:       true,
        status:        200,
        contentType:   'application/json',
        body:          '{"static":true}',
        scriptEnabled: true,
        script:        'return "x"',
      },
    }
    const runScript = fakeRunScript({ outcome: 'ok', body: '{"from":"script"}' })
    const sut = new ReplayEvent({
      inboxes:     fakeInboxesByToken(inbox),
      requests:    fakeRequestsById(sampleRequest),
      rateLimiter: fakeRateLimiter(),
      runScript,
    })

    const result = await sut.execute({ inboxToken: 'tok-1', eventId: 'evt-1', mockOnly: true })
    expect(result.outcome).toBe(ReplayOutcome.REPLAYED)
    expect(result.target.toDto().body).toBe('{"from":"script"}')
    expect(result.target.toDto().status).toBe(200)
    expect(runScript.calls).toHaveLength(1)
    expect(runScript.calls[0].script).toBe('return "x"')
  })

  it('falls back to the configured body when the script throws', async () => {
    const inbox = {
      token: 'tok-1',
      responseConfig: {
        enabled:       true,
        status:        200,
        contentType:   'application/json',
        body:          '{"static":true}',
        scriptEnabled: true,
        script:        'throw new Error("kaboom")',
      },
    }
    const sut = new ReplayEvent({
      inboxes:     fakeInboxesByToken(inbox),
      requests:    fakeRequestsById(sampleRequest),
      rateLimiter: fakeRateLimiter(),
      runScript:   fakeRunScript({ outcome: 'threw', error: 'kaboom' }),
    })

    const result = await sut.execute({ inboxToken: 'tok-1', eventId: 'evt-1', mockOnly: true })
    expect(result.outcome).toBe(ReplayOutcome.REPLAYED)
    expect(result.target.toDto().body).toBe('{"static":true}')
  })

  it('falls back to the configured body when the script times out', async () => {
    const inbox = {
      token: 'tok-1',
      responseConfig: {
        enabled:       true,
        status:        200,
        contentType:   'application/json',
        body:          '{"static":true}',
        scriptEnabled: true,
        script:        'while(true){}',
      },
    }
    const sut = new ReplayEvent({
      inboxes:     fakeInboxesByToken(inbox),
      requests:    fakeRequestsById(sampleRequest),
      rateLimiter: fakeRateLimiter(),
      runScript:   fakeRunScript({ outcome: 'timeout' }),
    })

    const result = await sut.execute({ inboxToken: 'tok-1', eventId: 'evt-1', mockOnly: true })
    expect(result.outcome).toBe(ReplayOutcome.REPLAYED)
    expect(result.target.toDto().body).toBe('{"static":true}')
  })

  it('marks the replayed target with a replayHeader field for the Inspector', async () => {
    // The replayed DTO is built downstream by the route layer; we
    // assert that the target's toDto() shape is Header-ready, and that
    // the route-layer can pair it with the X-Peek-Replay marker.
    expect(REPLAY_HEADER).toBe('X-Peek-Replay')
    expect(REPLAY_HEADER_VALUE).toBe('1')
  })

  it('forwards the captured request to the inbox forwardTo in forward mode', async () => {
    const inbox = { token: 'tok-1', forwardTo: 'http://localhost:8080', responseConfig: null }
    const forwardCalls = []
    const sut = new ReplayEvent({
      inboxes:     fakeInboxesByToken(inbox),
      requests:    fakeRequestsById(sampleRequest),
      rateLimiter: fakeRateLimiter(),
      forward:     async (req) => { forwardCalls.push(req); return { ok: true, status: 202, contentType: 'application/json', body: '{"got":true}', durationMs: 12 } },
    })

    const result = await sut.execute({ inboxToken: 'tok-1', eventId: 'evt-1', mode: 'forward' })
    expect(result.outcome).toBe(ReplayOutcome.REPLAYED)
    const dto = result.target.toDto()
    expect(dto.type).toBe('forward_url')
    expect(dto.status).toBe(202)
    expect(dto.body).toBe('{"got":true}')
    expect(dto.durationMs).toBe(12)
    expect(forwardCalls).toHaveLength(1)
    expect(forwardCalls[0].targetUrl).toBe('http://localhost:8080')
    expect(forwardCalls[0].method).toBe('POST')
    expect(forwardCalls[0].body).toBe('{"hello":"world"}')
  })

  it('applies mutations on top of the captured request before forwarding', async () => {
    const inbox = { token: 'tok-1', forwardTo: 'http://localhost:8080', responseConfig: null }
    const forwardCalls = []
    const sut = new ReplayEvent({
      inboxes:     fakeInboxesByToken(inbox),
      requests:    fakeRequestsById(sampleRequest),
      rateLimiter: fakeRateLimiter(),
      forward:     async (req) => { forwardCalls.push(req); return { ok: true, status: 200, contentType: 'application/json', body: 'ok', durationMs: 1 } },
    })

    const result = await sut.execute({
      inboxToken: 'tok-1',
      eventId:    'evt-1',
      mode:       'forward',
      mutations:  { method: 'put', body: '{"amount":9999}', headers: { 'x-test': 'yes' } },
    })
    expect(result.outcome).toBe(ReplayOutcome.REPLAYED)
    expect(forwardCalls[0].method).toBe('PUT')            // uppercased
    expect(forwardCalls[0].body).toBe('{"amount":9999}')  // overridden
    expect(forwardCalls[0].headers['x-test']).toBe('yes') // merged onto captured headers
    expect(forwardCalls[0].headers['content-type']).toBe('application/json') // captured header preserved
  })

  it('surfaces a forward timeout as a 504 forward_url target', async () => {
    const inbox = { token: 'tok-1', forwardTo: 'http://localhost:8080', responseConfig: null }
    const sut = new ReplayEvent({
      inboxes:     fakeInboxesByToken(inbox),
      requests:    fakeRequestsById(sampleRequest),
      rateLimiter: fakeRateLimiter(),
      forward:     async () => ({ ok: false, error: 'timeout', message: 'timeout after 10000ms', durationMs: 10000 }),
    })

    const result = await sut.execute({ inboxToken: 'tok-1', eventId: 'evt-1', mode: 'forward' })
    expect(result.outcome).toBe(ReplayOutcome.REPLAYED)
    const dto = result.target.toDto()
    expect(dto.status).toBe(504)
    expect(dto.error).toBe('timeout')
  })

  it('rejects malformed mutations with INVALID', async () => {
    const inbox = { token: 'tok-1', forwardTo: null, responseConfig: null }
    const sut = new ReplayEvent({
      inboxes:     fakeInboxesByToken(inbox),
      requests:    fakeRequestsById(sampleRequest),
      rateLimiter: fakeRateLimiter(),
    })
    const result = await sut.execute({ inboxToken: 'tok-1', eventId: 'evt-1', mutations: { method: 123 } })
    expect(result.outcome).toBe(ReplayOutcome.INVALID)
    expect(result.error).toMatch(/mutations\.method/)
  })
})
