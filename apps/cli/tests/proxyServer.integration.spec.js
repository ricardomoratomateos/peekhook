/**
 * Integration test for the peekgrok sniffer proxy (startProxyServer).
 *
 * Stands up two stub HTTP servers — a fake "upstream app" and a fake
 * "inspector" — plus a real in-memory SQLite inbox, then drives the proxy
 * over real HTTP to verify:
 *   - normal paths are forwarded to the upstream AND captured
 *   - inspector-owned paths (/c, /assets, /api/requests) are relayed to the
 *     inspector and NOT captured (this is what makes public share links work)
 *   - --ignore prefixes are forwarded but not captured
 *
 * Run: cd apps/cli && bun test tests/proxyServer.integration.spec.js
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import http from 'node:http'
import { Database } from 'bun:sqlite'
import { startProxyServer } from '../src/proxyServer.js'
import {
  SqliteInboxRepository,
  migrate as migrateInbox,
} from '@peekhook/api/src/inbox/infra/persistence/SqliteInboxRepository.js'
import {
  SqliteCapturedRequestRepository,
  migrate as migrateCaptured,
} from '@peekhook/api/src/inbox/infra/persistence/SqliteCapturedRequestRepository.js'
import { SqliteRequestListReadModel } from '@peekhook/api/src/inbox/infra/persistence/SqliteRequestListReadModel.js'
import { SandboxInbox } from '@peekhook/api/src/inbox/domain/SandboxInbox.js'

function stub(label) {
  const server = http.createServer((req, res) => {
    res.writeHead(200, { 'content-type': 'text/plain' })
    res.end(`${label}:${req.url}`)
  })
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port }))
  })
}

describe('startProxyServer routing', () => {
  let upstream, inspector, proxy, db, base, readModel

  beforeAll(async () => {
    upstream  = await stub('UPSTREAM')
    inspector = await stub('INSPECTOR')

    db = new Database(':memory:')
    migrateInbox(db)
    migrateCaptured(db)
    const inboxRepo = new SqliteInboxRepository(db)
    const capturedRequestRepo = new SqliteCapturedRequestRepository(db)
    readModel = new SqliteRequestListReadModel(db)
    const inbox = SandboxInbox.create()
    await inboxRepo.insert(inbox)
    global.__token = inbox.token

    proxy = await startProxyServer({
      port:                0,
      upstream:            `http://127.0.0.1:${upstream.port}`,
      sessionToken:        inbox.token,
      inboxRepo,
      capturedRequestRepo,
      ingestOrigin:        'http://localhost:9999',
      inspectorBase:       `http://127.0.0.1:${inspector.port}`,
      ignorePaths:         ['/health'],
    })
    base = `http://127.0.0.1:${proxy.server.address().port}`
  })

  afterAll(async () => {
    if (proxy) await proxy.close()
    upstream.server.close()
    inspector.server.close()
    db.close()
  })

  it('forwards a normal path to the upstream and captures it', async () => {
    const res = await fetch(`${base}/orders`, { method: 'POST', body: '{"x":1}', headers: { 'content-type': 'application/json' } })
    const text = await res.text()
    expect(text).toBe('UPSTREAM:/orders')
    const captured = await readModel.listAll({ inboxToken: global.__token })
    expect(captured.some((c) => c.path === '/orders')).toBe(true)
  })

  it('relays inspector-owned paths to the inspector and does NOT capture them', async () => {
    const before = (await readModel.listAll({ inboxToken: global.__token })).length
    const c = await (await fetch(`${base}/c/abc123?token=t`)).text()
    const assets = await (await fetch(`${base}/assets/index-x.js`)).text()
    const api = await (await fetch(`${base}/api/requests/deadbeef?token=t`)).text()
    expect(c).toBe('INSPECTOR:/c/abc123?token=t')
    expect(assets).toBe('INSPECTOR:/assets/index-x.js')
    expect(api).toBe('INSPECTOR:/api/requests/deadbeef?token=t')
    const after = (await readModel.listAll({ inboxToken: global.__token })).length
    expect(after).toBe(before)  // none of the inspector paths were captured
  })

  it('forwards --ignore paths to the upstream without capturing', async () => {
    const before = (await readModel.listAll({ inboxToken: global.__token })).length
    const text = await (await fetch(`${base}/health`)).text()
    expect(text).toBe('UPSTREAM:/health')
    const after = (await readModel.listAll({ inboxToken: global.__token })).length
    expect(after).toBe(before)
  })
})
