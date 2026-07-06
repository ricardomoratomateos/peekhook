import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { startMongo, getTestDb, stopMongo } from '../../test/helpers/mongoMemory.js'
import { MongoInboxRepository } from '../infra/persistence/MongoInboxRepository.js'
import { MongoCapturedRequestRepository } from '../infra/persistence/MongoCapturedRequestRepository.js'
import { SandboxInbox } from '../domain/SandboxInbox.js'
import { CaptureRequest } from './CaptureRequest.js'

describe('CaptureRequest', () => {
  let inboxes
  let requests
  let inbox

  beforeAll(async () => {
    const db = await startMongo()
    inboxes = new MongoInboxRepository(db)
    requests = new MongoCapturedRequestRepository(db)
    inbox = SandboxInbox.create()
    await inboxes.insert(inbox)
  })

  afterAll(async () => {
    await stopMongo()
  })

  it('captures a POST request and returns the inbox responseConfig', async () => {
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
})
