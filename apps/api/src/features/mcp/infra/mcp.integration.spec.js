import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { Readable, Writable } from 'node:stream'
import { startMongo, getTestDb, stopMongo } from '../../../../test/helpers/mongoMemory.js'
import { MongoInboxRepository } from '../../../infra/persistence/MongoInboxRepository.js'
import { MongoCapturedRequestRepository } from '../../../infra/persistence/MongoCapturedRequestRepository.js'
import { MongoRequestListReadModel } from '../../../infra/persistence/MongoRequestListReadModel.js'
import { CapturedRequest } from '../../../domain/CapturedRequest.js'
import { SandboxInbox } from '../../../domain/SandboxInbox.js'
import { MongoMcpAuthRepository } from '../infra/MongoMcpAuthRepository.js'
import { MongoRequestSearchReadModel } from '../infra/MongoRequestSearchReadModel.js'
import { MintMcpToken } from '../app/MintMcpToken.js'
import { provideTools } from '../infra/provideTools.js'
import { stdioTransport } from '../infra/stdioTransport.js'

async function waitForWrites(writes, n, timeoutMs = 5000) {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    const lines = writes.join('').split('\n').filter(Boolean)
    if (lines.length >= n) return lines
    await new Promise((r) => setTimeout(r, 10))
  }
  const lines = writes.join('').split('\n').filter(Boolean)
  throw new Error(`timeout: only ${lines.length} of ${n} lines written (got: ${JSON.stringify(writes)})`)
}

describe('mcp integration (Fastify + Mongo + stdio transport)', () => {
  let inbox
  let mcpToken
  let capturedIds

  beforeAll(async () => {
    const db = await startMongo()
    const inboxes = new MongoInboxRepository(db)
    const requests = new MongoCapturedRequestRepository(db)
    const mcpAuth  = new MongoMcpAuthRepository(db)

    inbox = SandboxInbox.create()
    await inboxes.insert(inbox)

    const mint = new MintMcpToken({ mcpAuth })
    const r = await mint.execute({ inboxToken: inbox.token })
    mcpToken = r.mcpToken

    const now = new Date()
    const expiresAt = new Date(now.getTime() + 86_400_000)
    const headersStripe = { 'content-type': 'application/json' }
    const headersGithub = { 'content-type': 'application/json', 'x-github-event': 'push' }

    const id1 = requests.nextId()
    const id2 = requests.nextId()
    await requests.insert(CapturedRequest.create({
      id: id1,
      inboxToken: inbox.token,
      method: 'POST',
      path: '/i/' + inbox.token,
      query: {},
      headers: headersStripe,
      body: '{"id":"evt_1","object":"event","data":{"object":{"amount":100}}}',
      contentType: 'application/json',
      size: 13,
      ip: '127.0.0.1',
      now,
      expiresAt,
    }))
    await requests.insert(CapturedRequest.create({
      id: id2,
      inboxToken: inbox.token,
      method: 'POST',
      path: '/i/' + inbox.token,
      query: {},
      headers: headersGithub,
      body: '{"ref":"main"}',
      contentType: 'application/json',
      size: 13,
      ip: '127.0.0.1',
      now,
      expiresAt,
    }))
    capturedIds = [id1.toString(), id2.toString()]
  })

  afterAll(async () => { await stopMongo() })

  it('exchanges JSON-RPC over a stdio pair end-to-end', async () => {
    const db = getTestDb()
    const mcpAuth    = new MongoMcpAuthRepository(db)
    const readModel  = new MongoRequestListReadModel(db)
    const searchModel = new MongoRequestSearchReadModel(db)
    const surface = provideTools({ mcpAuth, readModel, searchModel })

    const writes = []
    const stdout = new Writable({ write(chunk, _enc, cb) { writes.push(chunk.toString()); cb() } })
    const stdin = Readable.from([
      JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }) + '\n',
      JSON.stringify({
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/call',
        params: { name: 'list_events', arguments: { inbox_token: inbox.token, mcp_token: mcpToken, limit: 5 } },
      }) + '\n',
      JSON.stringify({
        jsonrpc: '2.0',
        id: 3,
        method: 'tools/call',
        params: {
          name: 'explain_event',
          arguments: { inbox_token: inbox.token, mcp_token: mcpToken, event_id: capturedIds[1] },
        },
      }) + '\n',
    ])

    stdioTransport({
      stdin, stdout,
      listTools: surface.listTools,
      callTool:  surface.callTool,
    })

    const lines = await waitForWrites(writes, 3)
    const resps = lines.map(JSON.parse)
    expect(resps[0].id).toBe(1)
    expect(resps[0].result.tools.map((t) => t.name)).toEqual([
      'list_events', 'get_event', 'search_events', 'diff_events', 'explain_event',
    ])

    expect(resps[1].id).toBe(2)
    expect(Array.isArray(resps[1].result.events)).toBe(true)
    expect(resps[1].result.events.length).toBe(2)

    expect(resps[2].id).toBe(3)
    expect(resps[2].result.provider).toBe('github')
    expect(resps[2].result.summary).toContain('push')
  })

  it('returns a transport-level JSON-RPC error when the mcp token is wrong', async () => {
    const db = getTestDb()
    const mcpAuth    = new MongoMcpAuthRepository(db)
    const readModel  = new MongoRequestListReadModel(db)
    const searchModel = new MongoRequestSearchReadModel(db)
    const surface = provideTools({ mcpAuth, readModel, searchModel })

    const writes = []
    const stdout = new Writable({ write(chunk, _enc, cb) { writes.push(chunk.toString()); cb() } })
    const stdin = Readable.from([
      JSON.stringify({
        jsonrpc: '2.0',
        id: 99,
        method: 'tools/call',
        params: {
          name: 'list_events',
          arguments: { inbox_token: inbox.token, mcp_token: 'definitely-wrong-token' },
        },
      }) + '\n',
    ])

    stdioTransport({
      stdin, stdout,
      listTools: surface.listTools,
      callTool:  surface.callTool,
    })

    const lines = await waitForWrites(writes, 1)
    const resp = JSON.parse(lines[0])
    expect(resp.id).toBe(99)
    expect(resp.error).toBeDefined()
    expect(resp.error.message).toMatch(/auth failed/)
  })

  it('replies with method-not-found for unknown JSON-RPC methods', async () => {
    const db = getTestDb()
    const mcpAuth    = new MongoMcpAuthRepository(db)
    const readModel  = new MongoRequestListReadModel(db)
    const searchModel = new MongoRequestSearchReadModel(db)
    const surface = provideTools({ mcpAuth, readModel, searchModel })

    const writes = []
    const stdout = new Writable({ write(chunk, _enc, cb) { writes.push(chunk.toString()); cb() } })
    const stdin = Readable.from([
      JSON.stringify({ jsonrpc: '2.0', id: 7, method: 'tools/poke', params: {} }) + '\n',
    ])

    stdioTransport({
      stdin, stdout,
      listTools: surface.listTools,
      callTool:  surface.callTool,
    })

    const lines = await waitForWrites(writes, 1)
    const resp = JSON.parse(lines[0])
    expect(resp.id).toBe(7)
    expect(resp.error.code).toBe(-32601)
  })
})
