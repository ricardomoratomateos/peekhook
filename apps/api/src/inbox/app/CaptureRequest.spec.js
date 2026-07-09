import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { startMongo, stopMongo } from '../../../test/helpers/mongoMemory.js'
import { MongoInboxRepository } from '../infra/persistence/MongoInboxRepository.js'
import { MongoCapturedRequestRepository } from '../infra/persistence/MongoCapturedRequestRepository.js'
import { SandboxInbox, MAX_CAPTURE_COUNT } from '../domain/SandboxInbox.js'
import { CaptureRequest } from './CaptureRequest.js'

describe('CaptureRequest', () => {
  let db
  let inboxes
  let requests

  beforeAll(async () => {
    db = await startMongo()
    inboxes  = new MongoInboxRepository(db)
    requests = new MongoCapturedRequestRepository(db)
  })

  afterAll(async () => {
    await stopMongo()
  })

  it('captures a POST request and returns the inbox responseConfig', async () => {
    const inbox = SandboxInbox.create()
    await inboxes.insert(inbox)
    const sut = new CaptureRequest({ inboxes, requests })
    const result = await sut.execute({
      inboxToken: inbox.token,
      method: 'POST',
      path: '/i/' + inbox.token,
      query: {},
      headers: { 'content-type': 'application/json' },
      body: '{"event":"hello"}',
      contentType: 'application/json',
      size: 17,
      ip: '127.0.0.1',
    })

    expect(result.outcome).toBe('captured')
    expect(result.id).toBeDefined()
    expect(result.responseConfig).toBeNull()
  })

  it('returns inbox_not_found when the token does not match an inbox', async () => {
    const sut = new CaptureRequest({ inboxes, requests })
    const result = await sut.execute({
      inboxToken: 'no-such-token',
      method: 'POST',
      path: '/i/no-such-token',
      query: {},
      headers: {},
      body: '',
      contentType: '',
      size: 0,
      ip: '127.0.0.1',
    })
    expect(result.outcome).toBe('inbox_not_found')
    expect(result.responseConfig).toBeNull()
  })

  it('returns the inbox responseConfig if one is set', async () => {
    const second = SandboxInbox.create()
    await inboxes.insert(second)
    await inboxes.updateResponseConfig(second.token, {
      enabled: true,
      status: 503,
      contentType: 'text/plain',
      body: 'upstream busy',
    })

    const sut = new CaptureRequest({ inboxes, requests })
    const result = await sut.execute({
      inboxToken: second.token,
      method: 'POST',
      path: '/i/' + second.token,
      query: {},
      headers: {},
      body: '',
      contentType: '',
      size: 0,
      ip: '127.0.0.1',
    })

    expect(result.outcome).toBe('captured')
    expect(result.responseConfig).toEqual({
      enabled: true,
      status: 503,
      contentType: 'text/plain',
      body: 'upstream busy',
    })
  })

  it('strips NUL and RTL-override characters from headers before persisting', async () => {
    const inbox = SandboxInbox.create()
    await inboxes.insert(inbox)
    const sut = new CaptureRequest({ inboxes, requests })
    const result = await sut.execute({
      inboxToken: inbox.token,
      method: 'POST',
      path: '/i/' + inbox.token,
      query: {},
      headers: {
        'content-type': 'application/json',
        'x-filename':   'invoice\u202Epdf.exe',
        'x-evil':       'a\u0000b',
      },
      body: '{}',
      contentType: 'application/json',
      size: 2,
      ip: '127.0.0.1',
    })
    expect(result.outcome).toBe('captured')

    const persisted = await db.collection('requests').findOne({ _id: result.id })
    expect(persisted.headers['x-filename']).toBe('invoicepdf.exe')
    expect(persisted.headers['x-evil']).toBe('ab')
    expect(persisted.headers['content-type']).toBe('application/json')
  })

  it('returns capacity_exceeded once the inbox has MAX_CAPTURE_COUNT captures', async () => {
    const inbox = SandboxInbox.create({
      captureCount: MAX_CAPTURE_COUNT,
    })
    await inboxes.insert(inbox)
    const sut = new CaptureRequest({ inboxes, requests })
    const result = await sut.execute({
      inboxToken: inbox.token,
      method: 'POST',
      path: '/i/' + inbox.token,
      query: {},
      headers: {},
      body: '{}',
      contentType: 'application/json',
      size: 2,
      ip: '127.0.0.1',
    })
    expect(result.outcome).toBe('capacity_exceeded')
  })

  it('does not capture, persist, or consume a slot when the allowlist rejects the request', async () => {
    const inbox = SandboxInbox.create()
    await inboxes.insert(inbox)
    await inboxes.updateCaptureFilter(inbox.token, { paths: ['/webhooks/stripe'] })

    const sut = new CaptureRequest({ inboxes, requests })
    const result = await sut.execute({
      inboxToken: inbox.token,
      method: 'POST',
      path: '/some/other/path',
      query: {},
      headers: {},
      body: '{}',
      contentType: 'application/json',
      size: 2,
      ip: '127.0.0.1',
    })

    expect(result.outcome).toBe('filtered')
    expect(result.id).toBeUndefined()

    // nothing persisted
    const count = await db.collection('requests').countDocuments({ inboxToken: inbox.token })
    expect(count).toBe(0)
    // no slot consumed — the lifetime counter stayed at 0
    const fresh = await inboxes.findByToken(inbox.token)
    expect(fresh.captureCount).toBe(0)
  })

  it('still surfaces responseConfig / forwardTo on a filtered request so the caller gets a reply', async () => {
    const inbox = SandboxInbox.create()
    await inboxes.insert(inbox)
    await inboxes.updateCaptureFilter(inbox.token, { methods: ['PUT'] })
    await inboxes.updateForwardTo(inbox.token, 'http://localhost:9/hook')

    const sut = new CaptureRequest({ inboxes, requests })
    const result = await sut.execute({
      inboxToken: inbox.token,
      method: 'POST', // not PUT -> filtered
      path: '/x',
      query: {},
      headers: {},
      body: '{}',
      contentType: 'application/json',
      size: 2,
      ip: '127.0.0.1',
    })

    expect(result.outcome).toBe('filtered')
    expect(result.forwardTo).toBe('http://localhost:9/hook')
  })

  it('captures normally when the request matches the allowlist', async () => {
    const inbox = SandboxInbox.create()
    await inboxes.insert(inbox)
    await inboxes.updateCaptureFilter(inbox.token, { methods: ['POST'], paths: ['/hook/*'] })

    const sut = new CaptureRequest({ inboxes, requests })
    const result = await sut.execute({
      inboxToken: inbox.token,
      method: 'POST',
      path: '/hook/abc',
      query: {},
      headers: {},
      body: '{}',
      contentType: 'application/json',
      size: 2,
      ip: '127.0.0.1',
    })

    expect(result.outcome).toBe('captured')
    expect(result.id).toBeDefined()
  })

  it('returns rate_limited with retryAfterSec after 60 captures inside the window', async () => {
    const inbox = SandboxInbox.create()
    await inboxes.insert(inbox)
    const sut = new CaptureRequest({ inboxes, requests })

    for (let i = 0; i < 60; i++) {
      const r = await sut.execute({
        inboxToken: inbox.token,
        method: 'POST',
        path: '/i/' + inbox.token,
        query: {},
        headers: {},
        body: '{}',
        contentType: 'application/json',
        size: 2,
        ip: '127.0.0.1',
      })
      expect(r.outcome).toBe('captured')
    }

    const blocked = await sut.execute({
      inboxToken: inbox.token,
      method: 'POST',
      path: '/i/' + inbox.token,
      query: {},
      headers: {},
      body: '{}',
      contentType: 'application/json',
      size: 2,
      ip: '127.0.0.1',
    })
    expect(blocked.outcome).toBe('rate_limited')
    expect(blocked.retryAfterSec).toBeGreaterThan(0)
    expect(blocked.retryAfterSec).toBeLessThanOrEqual(60)
  })
})
