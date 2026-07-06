import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import Fastify from 'fastify'
import { startMongo, getTestDb, stopMongo } from '../../../test/helpers/mongoMemory.js'
import { MongoInboxRepository } from '../../inbox/infra/persistence/MongoInboxRepository.js'
import { MongoCapturedRequestRepository } from '../../inbox/infra/persistence/MongoCapturedRequestRepository.js'
import { SandboxInbox } from '../../inbox/domain/SandboxInbox.js'
import { CapturedRequest } from '../../inbox/domain/CapturedRequest.js'
import { MongoMcpAuthRepository } from '../infra/MongoMcpAuthRepository.js'
import { MintMcpToken } from '../app/MintMcpToken.js'
import { registerMcpRoutes } from '../infra/mcp.http.js'

const mockDb = vi.hoisted(() => ({ db: null }))

vi.mock('../../shared/db.js', () => ({
  connectDb: async () => {},
  getDb:     () => mockDb.db,
  closeDb:   async () => {},
}))

describe('mcp HTTP transport (Fastify inject + memory Mongo)', () => {
  let server
  let inboxToken
  let mcpToken

  beforeAll(async () => {
    const db = await startMongo()
    mockDb.db = db

    const inbox = SandboxInbox.create()
    await new MongoInboxRepository(db).insert(inbox)
    inboxToken = inbox.token

    const { mcpToken: minted } = await new MintMcpToken({ mcpAuth: new MongoMcpAuthRepository(db) })
      .execute({ inboxToken })
    mcpToken = minted

    const now = new Date()
    const expiresAt = new Date(now.getTime() + 86_400_000)
    const requests = new MongoCapturedRequestRepository(db)

    const id1 = requests.nextId()
    const id2 = requests.nextId()
    await requests.insert(CapturedRequest.create({
      id: id1,
      inboxToken,
      method: 'POST',
      path: '/i/' + inboxToken,
      query: {},
      headers: { 'content-type': 'application/json' },
      body: '{"id":"evt_1","object":"event","data":{"object":{"amount":100}}}',
      contentType: 'application/json',
      size: 13,
      ip: '127.0.0.1',
      now,
      expiresAt,
    }))
    await requests.insert(CapturedRequest.create({
      id: id2,
      inboxToken,
      method: 'POST',
      path: '/i/' + inboxToken,
      query: {},
      headers: { 'content-type': 'application/json', 'x-github-event': 'push' },
      body: '{"ref":"main"}',
      contentType: 'application/json',
      size: 13,
      ip: '127.0.0.1',
      now,
      expiresAt,
    }))

    server = Fastify({ logger: false })
    await server.register(registerMcpRoutes)
    await server.ready()

    return { id1: id1.toString(), id2: id2.toString() }
  })

  afterAll(async () => {
    if (server) await server.close()
    await stopMongo()
  })

  async function send(body, headers = {}) {
    return server.inject({
      method:  'POST',
      url:     '/mcp',
      headers: {
        'content-type': 'application/json',
        accept:         'application/json, text/event-stream',
        ...headers,
      },
      payload: typeof body === 'string' ? body : JSON.stringify(body),
    })
  }

  async function callTool(name, args, opts = {}) {
    const headers = opts.token !== null
      ? { authorization: `Bearer ${opts.token ?? mcpToken}` }
      : {}
    const response = await send({
      jsonrpc: '2.0', id: 1, method: 'tools/call',
      params: { name, arguments: args },
    }, headers)
    return { status: response.statusCode, body: JSON.parse(response.body) }
  }

  it('advertises the expected tool surface on tools/list', async () => {
    const response = await send({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} },
      { authorization: `Bearer ${mcpToken}` })
    expect(response.statusCode).toBe(200)
    const body = JSON.parse(response.body)
    expect(body.id).toBe(1)
    expect(body.result.tools.map((t) => t.name)).toEqual([
      'list_events', 'get_event', 'search_events', 'diff_events', 'explain_event',
    ])
    for (const tool of body.result.tools) {
      expect(tool.inputSchema).toBeDefined()
      expect(tool.inputSchema.properties).toBeDefined()
      expect(tool.inputSchema.properties.inbox_token).toBeUndefined()
      expect(tool.inputSchema.properties.mcp_token).toBeUndefined()
    }
  })

  it('completes an initialize + tools/list + tools/call flow', async () => {
    const init = await send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} },
      { authorization: `Bearer ${mcpToken}` })
    expect(init.statusCode).toBe(200)
    const initBody = JSON.parse(init.body)
    expect(initBody.result.serverInfo.name).toBe('peekhook')
    expect(initBody.result.capabilities.tools).toBeDefined()

    const ack = await send({ jsonrpc: '2.0', method: 'notifications/initialized' },
      { authorization: `Bearer ${mcpToken}` })
    expect(ack.statusCode).toBe(202)

    const call = await callTool('list_events', { limit: 5 })
    expect(call.status).toBe(200)
    expect(call.body.id).toBe(1)
    expect(Array.isArray(call.body.result.content)).toBe(true)
    expect(call.body.result.content[0].type).toBe('text')
    const text = JSON.parse(call.body.result.content[0].text)
    expect(text.events.length).toBe(2)
    expect(call.body.result.structuredContent.events.length).toBe(2)
  })

  it('runs explain_event end-to-end via Bearer auth', async () => {
    const response = await send({
      jsonrpc: '2.0', id: 1, method: 'tools/call',
      params: {
        name: 'explain_event',
        arguments: { event_id: await githubEventId(getTestDb()) },
      },
    }, { authorization: `Bearer ${mcpToken}` })
    expect(response.statusCode).toBe(200)
    const body = JSON.parse(response.body)
    expect(body.result.structuredContent.provider).toBe('github')
    expect(body.result.structuredContent.summary).toContain('push')
  })

  it('returns 401 with WWW-Authenticate when no Bearer header is sent', async () => {
    const response = await send({
      jsonrpc: '2.0', id: 1, method: 'tools/call',
      params: { name: 'list_events', arguments: {} },
    })
    expect(response.statusCode).toBe(401)
    expect(response.headers['www-authenticate']).toMatch(/Bearer/)
    const body = JSON.parse(response.body)
    expect(body.error.code).toBe(-32001)
  })

  it('returns 401 when the Bearer token does not match an inbox', async () => {
    const response = await send({
      jsonrpc: '2.0', id: 1, method: 'tools/call',
      params: { name: 'list_events', arguments: {} },
    }, { authorization: 'Bearer definitely-not-a-real-token' })
    expect(response.statusCode).toBe(401)
    const body = JSON.parse(response.body)
    expect(body.error.message).toMatch(/invalid token/)
  })

  it('rejects Authorization headers that are not Bearer', async () => {
    const response = await send({
      jsonrpc: '2.0', id: 1, method: 'tools/call',
      params: { name: 'list_events', arguments: {} },
    }, { authorization: `Basic ${mcpToken}` })
    expect(response.statusCode).toBe(401)
    const body = JSON.parse(response.body)
    expect(body.error.message).toMatch(/Bearer/)
  })

  it('returns method-not-found for unknown JSON-RPC methods', async () => {
    const response = await send({ jsonrpc: '2.0', id: 7, method: 'tools/poke', params: {} },
      { authorization: `Bearer ${mcpToken}` })
    expect(response.statusCode).toBe(200)
    const body = JSON.parse(response.body)
    expect(body.id).toBe(7)
    expect(body.error.code).toBe(-32601)
    expect(body.error.message).toMatch(/tools\/poke/)
  })

  it('returns invalid-params when tools/call is missing name', async () => {
    const response = await send({
      jsonrpc: '2.0', id: 8, method: 'tools/call',
      params: { arguments: {} },
    }, { authorization: `Bearer ${mcpToken}` })
    expect(response.statusCode).toBe(200)
    const body = JSON.parse(response.body)
    expect(body.error.code).toBe(-32602)
  })

  it('returns 405 for GET /mcp', async () => {
    const response = await server.inject({ method: 'GET', url: '/mcp' })
    expect(response.statusCode).toBe(405)
    expect(response.headers.allow).toBe('POST')
  })

  it('returns parse-error for malformed JSON bodies', async () => {
    const response = await send('not-json-at-all',
      { authorization: `Bearer ${mcpToken}` })
    expect(response.statusCode).toBe(400)
    const body = JSON.parse(response.body)
    expect(body.error.code).toBe(-32700)
  })
})

async function githubEventId(db) {
  const docs = await db.collection('requests').find({ 'headers.x-github-event': 'push' }).limit(1).toArray()
  return docs[0]._id.toString()
}
