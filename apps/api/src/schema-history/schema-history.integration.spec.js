import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { startMongo, getTestDb, stopMongo } from '../../test/helpers/mongoMemory.js'
import { SandboxInbox }    from '../inbox/domain/SandboxInbox.js'
import { MongoInboxRepository } from '../inbox/infra/persistence/MongoInboxRepository.js'
import { MongoCapturedRequestRepository } from '../inbox/infra/persistence/MongoCapturedRequestRepository.js'
import { CaptureRequest } from '../inbox/app/CaptureRequest.js'
import { RecordSchema }   from './app/RecordSchema.js'
import { GetSchemaHistory } from './app/GetSchemaHistory.js'
import { MongoPayloadSchemaRepository } from './infra/MongoPayloadSchemaRepository.js'

describe('schema-history (full stack)', () => {
  let db
  let inboxes
  let requests
  let schemas

  beforeAll(async () => {
    db = await startMongo()
    inboxes = new MongoInboxRepository(db)
    requests = new MongoCapturedRequestRepository(db)
    schemas  = new MongoPayloadSchemaRepository(db)
  })

  afterAll(async () => {
    await stopMongo()
  })

  it('records the spec fixture: three evolving payloads yield chronological fields, with a type entry for a', async () => {
    const inbox = SandboxInbox.create()
    await inboxes.insert(inbox)
    const token = inbox.token

    const nowHolder = { value: new Date(Date.UTC(2026, 0, 1, 0, 0, 0)) }
    const nowFn = () => nowHolder.value
    const recordSchema = new RecordSchema({ schemas, now: nowFn })
    const captureRequest = new CaptureRequest({ inboxes, requests, recordSchema, now: nowFn })
    const getHistory     = new GetSchemaHistory({ schemas })

    nowHolder.value = new Date(Date.UTC(2026, 0, 1, 0, 0, 0))
    await captureRequest.execute({ inboxToken: token, method: 'POST', path: '/i/' + token,
      query: {}, headers: {}, body: '{"a":1}',
      contentType: 'application/json', size: 7, ip: '127.0.0.1' })
    nowHolder.value = new Date(Date.UTC(2026, 0, 1, 0, 0, 5))
    await captureRequest.execute({ inboxToken: token, method: 'POST', path: '/i/' + token,
      query: {}, headers: {}, body: '{"a":"x","b":2}',
      contentType: 'application/json', size: 15, ip: '127.0.0.1' })
    nowHolder.value = new Date(Date.UTC(2026, 0, 1, 0, 0, 9))
    await captureRequest.execute({ inboxToken: token, method: 'POST', path: '/i/' + token,
      query: {}, headers: {}, body: '{"a":"x","b":3,"c":[1]}',
      contentType: 'application/json', size: 18, ip: '127.0.0.1' })

    const dto = await getHistory.execute({ inboxToken: token })

    // Two observation slots for `a`: number (first), then string.
    const aEntries = dto.fields.filter((f) => f.path === 'a')
    expect(aEntries).toHaveLength(2)
    expect(aEntries.find((f) => f.type === 'number')).toBeDefined()
    expect(aEntries.find((f) => f.type === 'string')).toBeDefined()

    expect(dto.fields.map((f) => [f.path, f.type, f.occurrences])).toEqual([
      ['a', 'number', 1],
      ['a', 'string', 2],
      ['b', 'number', 2],
      ['c', 'array',  1],
    ])
  })

  it('keeps chronological order across multiple rounds with varying timestamps and re-observes', async () => {
    const inbox = SandboxInbox.create()
    await inboxes.insert(inbox)
    const token = inbox.token

    const nowHolder = { value: new Date(Date.UTC(2026, 0, 1, 0, 0, 0)) }
    const nowFn = () => nowHolder.value
    const recordSchema = new RecordSchema({ schemas, now: nowFn })
    const captureRequest = new CaptureRequest({ inboxes, requests, recordSchema, now: nowFn })
    const getHistory     = new GetSchemaHistory({ schemas })

    nowHolder.value = new Date(Date.UTC(2026, 0, 1, 0, 0, 0))
    await captureRequest.execute({ inboxToken: token, method: 'POST', path: '/i/' + token,
      query: {}, headers: {}, body: '{"a":1}',
      contentType: 'application/json', size: 7, ip: '127.0.0.1' })

    nowHolder.value = new Date(Date.UTC(2026, 0, 1, 0, 0, 3))
    await captureRequest.execute({ inboxToken: token, method: 'POST', path: '/i/' + token,
      query: {}, headers: {}, body: '{"a":"v","b":"two"}',
      contentType: 'application/json', size: 16, ip: '127.0.0.1' })
    await captureRequest.execute({ inboxToken: token, method: 'POST', path: '/i/' + token,
      query: {}, headers: {}, body: '{"a":"v","b":"two"}',
      contentType: 'application/json', size: 16, ip: '127.0.0.1' })

    const dto = await getHistory.execute({ inboxToken: token })
    const seen = dto.fields.map((f) => [f.path, f.type, f.firstSeenAt.getTime(), f.occurrences])
    expect(seen).toEqual([
      ['a', 'number', new Date(Date.UTC(2026, 0, 1, 0, 0, 0)).getTime(), 1],
      ['a', 'string', new Date(Date.UTC(2026, 0, 1, 0, 0, 3)).getTime(), 2],
      ['b', 'string', new Date(Date.UTC(2026, 0, 1, 0, 0, 3)).getTime(), 2],
    ])
  })

  it('skips malformed JSON bodies: only the well-formed capture appears in history', async () => {
    const inbox = SandboxInbox.create()
    await inboxes.insert(inbox)
    const token = inbox.token

    const recordSchema = new RecordSchema({ schemas })
    const captureRequest = new CaptureRequest({ inboxes, requests, recordSchema })
    const getHistory     = new GetSchemaHistory({ schemas })

    await captureRequest.execute({ inboxToken: token, method: 'POST', path: '/i/' + token,
      query: {}, headers: {}, body: 'not json at all',
      contentType: 'text/plain', size: 16, ip: '127.0.0.1' })
    await captureRequest.execute({ inboxToken: token, method: 'POST', path: '/i/' + token,
      query: {}, headers: {}, body: '{"hello":"world"}',
      contentType: 'application/json', size: 17, ip: '127.0.0.1' })

    const dto = await getHistory.execute({ inboxToken: token })
    expect(dto.fields).toEqual([
      { path: 'hello', type: 'string',
        firstSeenAt: expect.any(Date),
        lastSeenAt:  expect.any(Date),
        occurrences: 1 },
    ])
  })
})
