/**
 * Smoke test for local-mode MCP (SQLite backend).
 *
 * Exercises the wiring from `cli.js`: spins up an in-memory
 * `bun:sqlite` database, runs the adapter migrations, mints an MCP
 * token, builds the Fastify app via `buildApp`, listens on a random
 * port, and round-trips a real HTTP request through `POST /mcp` with
 * `Authorization: Bearer <token>`.
 *
 * Runs under Bun's test runner (which has `bun:sqlite` available and
 * supports the SQLite adapters used by `peekgrok`). Vitest runs
 * under Node and does NOT have `bun:sqlite` — the test is placed
 * under `tests/` (outside the vitest include glob) so vitest never
 * tries to load it. To execute:
 *
 *     cd apps/api && bun test tests/sqlite-mcp.integration.spec.js
 *
 * Scenarios:
 *   1. tools/list returns the expected 5-tool surface
 *   2. list_events returns empty when the inbox has no captures
 *   3. After a capture to `/i/:token`, list_events sees it
 *   4. No Authorization header → 401 + WWW-Authenticate
 *   5. Bearer with a wrong token → 401 + "invalid token"
 *   6. Audit log row was written (one row per authenticated tools/call)
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { Database } from 'bun:sqlite'
import { SqliteInboxRepository, migrate as migrateInbox } from '../src/inbox/infra/persistence/SqliteInboxRepository.js'
import { SqliteCapturedRequestRepository, migrate as migrateCaptured } from '../src/inbox/infra/persistence/SqliteCapturedRequestRepository.js'
import { SqliteRequestListReadModel, migrate as migrateReadModel } from '../src/inbox/infra/persistence/SqliteRequestListReadModel.js'
import { SqlitePayloadSchemaRepository, migrate as migrateSchema } from '../src/schema-history/infra/SqlitePayloadSchemaRepository.js'
import { SqliteRegexSearchRepository, migrate as migrateSearch } from '../src/search/infra/SqliteRegexSearchRepository.js'
import { SqliteMcpAuditLog, migrate as migrateMcpAuditLog } from '../src/mcp/infra/persistence/SqliteMcpAuditLog.js'
import { SqliteMcpRequestSearchReadModel } from '../src/mcp/infra/SqliteMcpRequestSearchReadModel.js'
import { InMemoryMcpRateLimiter } from '../src/mcp/infra/InMemoryMcpRateLimiter.js'
import { InMemoryReplayRateLimiter } from '../src/replay/infra/InMemoryReplayRateLimiter.js'
import { MemoryFixtureRepository } from '../src/fixtures/infra/MemoryFixtureRepository.js'
import { SEEDED_FIXTURES } from '../src/fixtures/fixtures/index.js'
import { SandboxInbox } from '../src/inbox/domain/SandboxInbox.js'
import { MintMcpToken } from '../src/mcp/app/MintMcpToken.js'
import { buildApp } from '../src/app.js'

const ORIGIN = 'http://localhost'

describe('local MCP over SQLite (POST /mcp)', () => {
  let db
  let app
  let baseUrl
  let inboxRepo
  let inboxToken
  let mcpToken
  let tokenHash

  beforeAll(async () => {
    db = new Database(':memory:')
    process.env.WEB_URL = ORIGIN
    migrateInbox(db)
    migrateCaptured(db)
    migrateReadModel(db)
    migrateSchema(db)
    migrateSearch(db)
    migrateMcpAuditLog(db)

    inboxRepo = new SqliteInboxRepository(db)
    const inbox = SandboxInbox.create()
    await inboxRepo.insert(inbox)
    inboxToken = inbox.token

    const mintResult = await new MintMcpToken({ mcpAuth: inboxRepo })
      .execute({ inboxToken })
    mcpToken = mintResult.mcpToken

    const crypto = await import('node:crypto')
    tokenHash = crypto.createHash('sha256').update(mcpToken).digest('hex')

    const mcpAuditLog        = new SqliteMcpAuditLog(db)
    const mcpSearchReadModel = new SqliteMcpRequestSearchReadModel(db)
    const mcpRateLimiter     = new InMemoryMcpRateLimiter()

    app = await buildApp(
      {
        inboxRepo:           inboxRepo,
        capturedRequestRepo: new SqliteCapturedRequestRepository(db),
        requestReadModel:    new SqliteRequestListReadModel(db),
        schemaRepo:          new SqlitePayloadSchemaRepository(db),
        searchRepo:          new SqliteRegexSearchRepository(db),
        fixtureRepo:         new MemoryFixtureRepository(SEEDED_FIXTURES),
        replayRateLimiter:   new InMemoryReplayRateLimiter(),
        mcpAuth:             inboxRepo,
        mcpAuditLog,
        mcpSearchReadModel,
        mcpRateLimiter,
      },
      { sseEnabled: true, mcpEnabled: true, shareEnabled: true },
    )
    await app.listen({ port: 0, host: '127.0.0.1' })
    const address = app.server.address()
    baseUrl = `http://127.0.0.1:${address.port}`
  }, 15_000)

  afterAll(async () => {
    if (app) await app.close()
    if (db) db.close()
  })

  async function postMcp(body, headers = {}) {
    const res = await fetch(`${baseUrl}/mcp`, {
      method:  'POST',
      headers: {
        'content-type': 'application/json',
        accept:         'application/json, text/event-stream',
        ...headers,
      },
      body: typeof body === 'string' ? body : JSON.stringify(body),
    })
    return { status: res.status, headers: res.headers, body: await res.json() }
  }

  async function callTool(name, args, opts = {}) {
    const headers = {}
    if (opts.token !== null) {
      headers.authorization = `Bearer ${opts.token ?? mcpToken}`
    }
    return postMcp({
      jsonrpc: '2.0', id: 1, method: 'tools/call',
      params: { name, arguments: args },
    }, headers)
  }

  it('advertises the 5 tools via tools/list (Bearer-authenticated)', async () => {
    const r = await postMcp({
      jsonrpc: '2.0', id: 1, method: 'tools/list', params: {},
    }, { authorization: `Bearer ${mcpToken}` })
    expect(r.status).toBe(200)
    expect(r.body.id).toBe(1)
    expect(r.body.result.tools.map((t) => t.name)).toEqual([
      'list_events', 'get_event', 'search_events', 'diff_events', 'explain_event',
    ])
  })

  it('list_events returns an empty list when the inbox has no captures', async () => {
    const r = await callTool('list_events', { limit: 50 })
    expect(r.status).toBe(200)
    expect(r.body.error).toBeUndefined()
    const text = JSON.parse(r.body.result.content[0].text)
    expect(text.events).toEqual([])
  })

  it('list_events sees a capture that was just sent to /i/:token', async () => {
    const capturePayload = '{"id":"evt_42","amount":4242}'
    const captureRes = await fetch(`${baseUrl}/i/${inboxToken}`, {
      method:  'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body:    capturePayload,
    })
    expect(captureRes.status).toBeGreaterThanOrEqual(200)
    expect(captureRes.status).toBeLessThan(300)

    const r = await callTool('list_events', { limit: 50 })
    expect(r.status).toBe(200)
    const text = JSON.parse(r.body.result.content[0].text)
    expect(text.events.length).toBe(1)
    expect(text.events[0].path).toBe(`/i/${inboxToken}`)
  })

  it('rejects POST /mcp without an Authorization header', async () => {
    const r = await callTool('list_events', {}, { token: null })
    expect(r.status).toBe(401)
    expect(r.headers.get('www-authenticate')).toMatch(/Bearer/)
    expect(r.body.error.code).toBe(-32001)
  })

  it('rejects POST /mcp with a Bearer token that does not match any inbox', async () => {
    const r = await callTool('list_events', {}, { token: 'definitely-not-a-real-token' })
    expect(r.status).toBe(401)
    expect(r.body.error.message).toMatch(/invalid token/)
  })

  it('writes one audit row per authenticated tools/call', async () => {
    const before = db
      .query('SELECT COUNT(*) AS n FROM mcp_audit_log WHERE token_hash = ?')
      .get(tokenHash).n

    const r = await callTool('list_events', { limit: 1 })
    expect(r.status).toBe(200)

    const after = db
      .query('SELECT COUNT(*) AS n FROM mcp_audit_log WHERE token_hash = ?')
      .get(tokenHash).n
    expect(after - before).toBe(1)

    const row = db
      .query(`
        SELECT * FROM mcp_audit_log
         WHERE token_hash = ?
         ORDER BY id DESC LIMIT 1
      `)
      .get(tokenHash)
    expect(row).toBeDefined()
    expect(row.tool).toBe('list_events')
    expect(JSON.parse(row.params)).toEqual({ limit: 1 })
    expect(row.token_hash).toBe(tokenHash)
  })
})
