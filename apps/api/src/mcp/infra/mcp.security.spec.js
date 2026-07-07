import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import Fastify from 'fastify'
import { startMongo, getTestDb, stopMongo } from '../../../test/helpers/mongoMemory.js'
import { MongoInboxRepository } from '../../inbox/infra/persistence/MongoInboxRepository.js'
import { MongoCapturedRequestRepository } from '../../inbox/infra/persistence/MongoCapturedRequestRepository.js'
import { SandboxInbox } from '../../inbox/domain/SandboxInbox.js'
import { CapturedRequest } from '../../inbox/domain/CapturedRequest.js'
import { MongoMcpAuthRepository } from '../infra/MongoMcpAuthRepository.js'
import { MintMcpToken } from '../app/MintMcpToken.js'
import { InMemoryMcpRateLimiter } from '../infra/InMemoryMcpRateLimiter.js'
import { registerMcpRoutes } from '../infra/mcp.http.js'
import { BODY_FIELD_CAP_BYTES } from '../app/SafeResponse.js'

const mockDb = vi.hoisted(() => ({ db: null }))

vi.mock('../../shared/db.js', () => ({
  connectDb: async () => {},
  getDb:     () => mockDb.db,
  closeDb:   async () => {},
}))

/**
 * Each test creates its own inbox + mcp token + events so the
 * rate limiter and audit log see a clean slate per case. MintMcpToken
 * overwrites the hash on the same inbox, so we always mint into a
 * fresh inbox (cheap — SandboxInbox.create is in-memory).
 */

beforeAll(async () => { mockDb.db = await startMongo() })
afterAll(async () => { await stopMongo() })

/**
 * Insert a fresh inbox with a fresh mcp token, plus two captured
 * events: one with a small JSON body, one with an oversized body
 * field. Returns everything a test needs to drive the route handler.
 */
async function freshInboxWithEvents({ bodySize = 'small' } = {}) {
  const db = getTestDb()
  const inbox = SandboxInbox.create()
  await new MongoInboxRepository(db).insert(inbox)
  const { mcpToken } = await new MintMcpToken({ mcpAuth: new MongoMcpAuthRepository(db) })
    .execute({ inboxToken: inbox.token })

  const now       = new Date()
  const expiresAt = new Date(now.getTime() + 86_400_000)
  const requests  = new MongoCapturedRequestRepository(db)

  const idJson = requests.nextId()
  await requests.insert(CapturedRequest.create({
    id: idJson, inboxToken: inbox.token, method: 'POST', path: '/i/' + inbox.token,
    query: {}, headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ id: 'evt_1', type: 'invoice.paid', amount: 100 }),
    contentType: 'application/json', size: 60,
    ip: '127.0.0.1', now, expiresAt,
  }))

  const idBig = requests.nextId()
  const bigPayload = bodySize === 'small'
    ? JSON.stringify({ note: 'small note' })
    : JSON.stringify({ note: 'x'.repeat(BODY_FIELD_CAP_BYTES + 200) })
  await requests.insert(CapturedRequest.create({
    id: idBig, inboxToken: inbox.token, method: 'POST', path: '/i/' + inbox.token,
    query: {}, headers: { 'content-type': 'application/json' },
    body: bigPayload, contentType: 'application/json', size: bigPayload.length,
    ip: '127.0.0.1', now, expiresAt,
  }))

  return { inbox, mcpToken, idJson: idJson.toString(), idBig: idBig.toString() }
}

async function freshSecondInbox() {
  const db = getTestDb()
  const inbox = SandboxInbox.create()
  await new MongoInboxRepository(db).insert(inbox)
  const { mcpToken } = await new MintMcpToken({ mcpAuth: new MongoMcpAuthRepository(db) })
    .execute({ inboxToken: inbox.token })
  return { inbox, mcpToken }
}

async function buildServer(rateLimiter, auditLog) {
  const server = Fastify({ logger: false })
  await server.register(registerMcpRoutes, {
    rateLimiter: rateLimiter ?? new InMemoryMcpRateLimiter(),
    ...(auditLog ? { auditLog } : {}),
  })
  await server.ready()
  return server
}

async function send(server, body, headers = {}) {
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

async function callTool(server, name, args, token) {
  if (!token) throw new Error('callTool requires a token')
  const response = await send(server, {
    jsonrpc: '2.0', id: 1, method: 'tools/call',
    params: { name, arguments: args },
  }, { authorization: `Bearer ${token}` })
  return { status: response.statusCode, headers: response.headers, body: JSON.parse(response.body) }
}

// ----------------------------------------------------------------------
// 1. Rate limit
// ----------------------------------------------------------------------
describe('mcp HTTP transport — rate limit (10/min per token hash)', () => {
  it('allows 10 calls within 60s, then rejects the 11th with 429 + Retry-After', async () => {
    const { mcpToken } = await freshInboxWithEvents()
    const limiter = new InMemoryMcpRateLimiter()
    const server  = await buildServer(limiter)
    try {
      for (let i = 0; i < 10; i++) {
        const r = await callTool(server, 'list_events', { limit: 1 }, mcpToken)
        expect(r.status).toBe(200)
        expect(r.body.error).toBeUndefined()
      }
      const blocked = await callTool(server, 'list_events', { limit: 1 }, mcpToken)
      expect(blocked.status).toBe(429)
      expect(blocked.headers['retry-after']).toBeDefined()
      const retryAfter = Number(blocked.headers['retry-after'])
      expect(retryAfter).toBeGreaterThan(0)
      expect(retryAfter).toBeLessThanOrEqual(60)
      expect(blocked.body.error.code).toBe(-32002)
      expect(blocked.body.error.message).toMatch(/rate limit/i)
    } finally {
      await server.close()
    }
  })

  it('keeps the buckets separate per token hash', async () => {
    const { mcpToken: tokenA } = await freshInboxWithEvents()
    const { mcpToken: tokenB } = await freshSecondInbox()
    const limiter = new InMemoryMcpRateLimiter()
    const server  = await buildServer(limiter)
    try {
      for (let i = 0; i < 10; i++) {
        const r = await callTool(server, 'list_events', { limit: 1 }, tokenA)
        expect(r.status).toBe(200)
      }
      const aBlocked = await callTool(server, 'list_events', { limit: 1 }, tokenA)
      expect(aBlocked.status).toBe(429)
      // Token B has a fresh budget.
      const bAllowed = await callTool(server, 'list_events', { limit: 1 }, tokenB)
      expect(bAllowed.status).toBe(200)
    } finally {
      await server.close()
    }
  })

  it('does NOT touch the read models / use cases when rate-limited', async () => {
    // We observe this by counting how many rate-limited calls land in
    // mcp_audit_log — a rate-limited call MUST NOT write an audit
    // entry (we audit AFTER the limiter passes).
    const { mcpToken } = await freshInboxWithEvents()
    const db = getTestDb()
    const before = await db.collection('mcp_audit_log').countDocuments({ tokenHash: { $exists: true } })

    const limiter = new InMemoryMcpRateLimiter()
    const server  = await buildServer(limiter)
    try {
      for (let i = 0; i < 11; i++) {
        await callTool(server, 'list_events', { limit: 1 }, mcpToken)
      }
    } finally {
      await server.close()
    }
    const after = await db.collection('mcp_audit_log').countDocuments({ tokenHash: { $exists: true } })
    // 10 successful calls write 10 audit entries; the 11th is
    // rate-limited and writes nothing.
    expect(after - before).toBe(10)
  })
})

// ----------------------------------------------------------------------
// 2. Audit log
// ----------------------------------------------------------------------
describe('mcp HTTP transport — audit log (mcp_audit_log)', () => {
  it('writes one entry per tools/call with tokenHash, tool, params, ip, timestamp', async () => {
    const { mcpToken } = await freshInboxWithEvents()
    const db = getTestDb()
    const before = await db.collection('mcp_audit_log').countDocuments({})

    const server = await buildServer(new InMemoryMcpRateLimiter())
    try {
      const r = await callTool(server, 'list_events', { limit: 3 }, mcpToken)
      expect(r.status).toBe(200)

      const after = await db.collection('mcp_audit_log').countDocuments({})
      expect(after - before).toBe(1)

      const entries = await db.collection('mcp_audit_log')
        .find({})
        .sort({ timestamp: -1 })
        .limit(1)
        .toArray()
      const last = entries[0]
      expect(last).toBeDefined()
      expect(last.tool).toBe('list_events')
      expect(last.tokenHash).toMatch(/^[0-9a-f]{64}$/)
      expect(last.params).toEqual({ limit: 3 })
      expect(last.timestamp).toBeInstanceOf(Date)
      expect(last.ip).toBeDefined()
    } finally {
      await server.close()
    }
  })

  it('never stores the plaintext mcp token anywhere in the audit row', async () => {
    const { mcpToken } = await freshInboxWithEvents()
    const server = await buildServer(new InMemoryMcpRateLimiter())
    try {
      await callTool(server, 'list_events', {}, mcpToken)
    } finally {
      await server.close()
    }

    const crypto = await import('node:crypto')
    const expectedHash = crypto.createHash('sha256').update(mcpToken).digest('hex')

    const db = getTestDb()
    const entries = await db.collection('mcp_audit_log').find({ tokenHash: expectedHash }).toArray()
    expect(entries.length).toBeGreaterThan(0)
    for (const entry of entries) {
      const blob = JSON.stringify(entry)
      expect(blob).not.toContain(mcpToken)
      // tokenHash equals the SHA-256 hex of the plaintext.
      expect(entry.tokenHash).toBe(expectedHash)
    }
  })

  it('replaces oversized string params with length-only objects', async () => {
    const { mcpToken } = await freshInboxWithEvents()
    const bigRegex = 'a'.repeat(BODY_FIELD_CAP_BYTES + 50)
    const server = await buildServer(new InMemoryMcpRateLimiter())
    try {
      const r = await callTool(server, 'search_events', { regex: bigRegex, field: 'path' }, mcpToken)
      expect(r.status).toBe(200)
    } finally {
      await server.close()
    }

    const db = getTestDb()
    const entries = await db.collection('mcp_audit_log')
      .find({ tool: 'search_events' })
      .sort({ timestamp: -1 })
      .limit(1)
      .toArray()
    expect(entries[0]).toBeDefined()
    const params = entries[0].params
    expect(params.regex).toEqual({
      length:         bigRegex.length,
      userControlled: true,
      truncated:      true,
    })
    // Plaintext is NOT stored in the audit row.
    expect(JSON.stringify(params)).not.toContain(bigRegex)
  })

  it('keeps the MCP call alive when the audit write would fail (best-effort)', async () => {
    const { mcpToken } = await freshInboxWithEvents()

    // Stub auditLog that always throws. The transport must catch the
    // rejection and let the tool call succeed anyway.
    const auditLog = {
      append: async () => { throw new Error('synthetic mongo outage') },
    }
    const server = await buildServer(new InMemoryMcpRateLimiter(), auditLog)
    try {
      const r = await callTool(server, 'list_events', { limit: 1 }, mcpToken)
      expect(r.status).toBe(200)
      expect(r.body.result.structuredContent).toBeDefined()
    } finally {
      await server.close()
    }
  })
})

// ----------------------------------------------------------------------
// 3. Prompt-injection wrappers
// ----------------------------------------------------------------------
describe('mcp HTTP transport — prompt-injection-safe tool responses', () => {
  it('search_events returns a list of safe projections with no raw body', async () => {
    const { mcpToken } = await freshInboxWithEvents()

    const server = await buildServer(new InMemoryMcpRateLimiter())
    try {
      const r = await callTool(server, 'search_events',
        { regex: 'evt_1', field: 'body' }, mcpToken)
      expect(r.status).toBe(200)
      const sc = r.body.result.structuredContent
      expect(Array.isArray(sc.events)).toBe(true)
      expect(sc.events.length).toBeGreaterThan(0)
      const evt = sc.events[0]
      // No raw body field.
      expect(evt.body).toBeUndefined()
      // Safe projection fields are present.
      expect(evt.id).toBeDefined()
      expect(evt.method).toBeDefined()
      expect(evt.path).toBeDefined()
      expect(evt.bodyFields).toBeDefined()
      // Top-level body fields are extracted (not the full body verbatim).
      expect(evt.bodyFields.id.value).toBe('evt_1')
      // userControlled marker is set.
      expect(evt.bodyFields.id.userControlled).toBe(true)
      // Full payload string must not appear anywhere in the response.
      const flat = JSON.stringify(sc)
      expect(flat).not.toContain('"amount":100,"id":"evt_1","type":"invoice.paid"')
    } finally {
      await server.close()
    }
  })

  it('search_events truncates oversized body fields with truncated:true', async () => {
    const { mcpToken } = await freshInboxWithEvents({ bodySize: 'big' })

    const server = await buildServer(new InMemoryMcpRateLimiter())
    try {
      const r = await callTool(server, 'search_events',
        { regex: 'note', field: 'body' }, mcpToken)
      expect(r.status).toBe(200)
      const sc = r.body.result.structuredContent
      const bigEvent = sc.events.find((e) => e.bodyFields?.note?.truncated === true)
      expect(bigEvent).toBeDefined()
      expect(bigEvent.bodyFields.note.length).toBeGreaterThan(BODY_FIELD_CAP_BYTES)
      expect(bigEvent.bodyFields.note.value).toBeUndefined()
      // userControlled marker is still set on truncated fields.
      expect(bigEvent.bodyFields.note.userControlled).toBe(true)
      // The full oversized string is NOT in the response.
      const flat = JSON.stringify(sc)
      expect(flat).not.toContain('x'.repeat(BODY_FIELD_CAP_BYTES + 50))
    } finally {
      await server.close()
    }
  })

  it('diff_events returns safe projections for both sides', async () => {
    const { mcpToken, idJson, idBig } = await freshInboxWithEvents({ bodySize: 'big' })

    const server = await buildServer(new InMemoryMcpRateLimiter())
    try {
      const r = await callTool(server, 'diff_events', {
        event_a_id: idJson,
        event_b_id: idBig,
      }, mcpToken)
      expect(r.status).toBe(200)
      const sc = r.body.result.structuredContent
      expect(sc.a).toBeDefined()
      expect(sc.b).toBeDefined()
      expect(sc.a.body).toBeUndefined()
      expect(sc.b.body).toBeUndefined()
      expect(sc.a.bodyFields).toBeDefined()
      expect(sc.b.bodyFields).toBeDefined()
      expect(sc.header_diff).toBeDefined()
      expect(sc.body_diff).toBeDefined()
    } finally {
      await server.close()
    }
  })

  it('get_event defaults to includeBody:false (safe projection)', async () => {
    const { mcpToken, idJson } = await freshInboxWithEvents()

    const server = await buildServer(new InMemoryMcpRateLimiter())
    try {
      const r = await callTool(server, 'get_event',
        { event_id: idJson }, mcpToken)
      expect(r.status).toBe(200)
      const sc = r.body.result.structuredContent
      expect(sc.body).toBeUndefined()
      expect(sc.bodyIncluded).toBe(false)
      expect(sc.bodyFields).toBeDefined()
      expect(sc.bodyFields.id.value).toBe('evt_1')
    } finally {
      await server.close()
    }
  })

  it('get_event includeBody:true returns the body, still wrapped and capped', async () => {
    const { mcpToken, idJson } = await freshInboxWithEvents()

    const server = await buildServer(new InMemoryMcpRateLimiter())
    try {
      const r = await callTool(server, 'get_event',
        { event_id: idJson, includeBody: true }, mcpToken)
      expect(r.status).toBe(200)
      const sc = r.body.result.structuredContent
      expect(sc.bodyIncluded).toBe(true)
      expect(sc.body).toBeDefined()
      expect(sc.body.userControlled).toBe(true)
    } finally {
      await server.close()
    }
  })

  it('list_events still returns DTOs (left as-is; defense is the per-token rate limit)', async () => {
    const { mcpToken } = await freshInboxWithEvents()

    const server = await buildServer(new InMemoryMcpRateLimiter())
    try {
      const r = await callTool(server, 'list_events', { limit: 5 }, mcpToken)
      expect(r.status).toBe(200)
      const sc = r.body.result.structuredContent
      expect(Array.isArray(sc.events)).toBe(true)
      expect(sc.events.length).toBeGreaterThan(0)
      // list_events returns raw DTOs (the inspector UI uses them).
      // The defense here is the per-token rate limit, not a safe
      // projection. Documented in provideTools.js.
      const evt = sc.events[0]
      expect(evt.id).toBeDefined()
    } finally {
      await server.close()
    }
  })

  it('explain_event returns the structured summary unchanged', async () => {
    const { mcpToken, idJson } = await freshInboxWithEvents()

    const server = await buildServer(new InMemoryMcpRateLimiter())
    try {
      const r = await callTool(server, 'explain_event',
        { event_id: idJson }, mcpToken)
      expect(r.status).toBe(200)
      const sc = r.body.result.structuredContent
      expect(sc.provider).toBeDefined()
      expect(sc.summary).toBeDefined()
      expect(sc.fields).toBeDefined()
      expect(sc.field_count).toBe(sc.fields.length)
    } finally {
      await server.close()
    }
  })
})