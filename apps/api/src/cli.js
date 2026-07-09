import { buildApp } from './app.js'
import { SqliteInboxRepository, migrate as migrateInbox } from './inbox/infra/persistence/SqliteInboxRepository.js'
import { SqliteCapturedRequestRepository, migrate as migrateCaptured } from './inbox/infra/persistence/SqliteCapturedRequestRepository.js'
import { SqliteRequestListReadModel, migrate as migrateReadModel } from './inbox/infra/persistence/SqliteRequestListReadModel.js'
import { SqlitePayloadSchemaRepository, migrate as migrateSchema } from './schema-history/infra/SqlitePayloadSchemaRepository.js'
import { SqliteRegexSearchRepository, migrate as migrateSearch } from './search/infra/SqliteRegexSearchRepository.js'
import { SqliteMcpRequestSearchReadModel } from './mcp/infra/SqliteMcpRequestSearchReadModel.js'
import { SqliteMcpAuditLog, migrate as migrateMcpAuditLog } from './mcp/infra/persistence/SqliteMcpAuditLog.js'
import { InMemoryMcpRateLimiter } from './mcp/infra/InMemoryMcpRateLimiter.js'
import { MemoryFixtureRepository } from './fixtures/infra/MemoryFixtureRepository.js'
import { SEEDED_FIXTURES } from './fixtures/fixtures/index.js'
import { InMemoryReplayRateLimiter } from './replay/infra/InMemoryReplayRateLimiter.js'
import { readFileSync, existsSync, statSync } from 'node:fs'
import { resolve, join, extname } from 'node:path'

let singletonRateLimiter

function getReplayRateLimiter() {
  if (!singletonRateLimiter) singletonRateLimiter = new InMemoryReplayRateLimiter()
  return singletonRateLimiter
}

/**
 * Local-only entry point for the peekhook binary (`peekgrok`).
 *
 * The cloud entry point (`index.js`) wires Mongo adapters; this one wires
 * SQLite adapters against a `bun:sqlite` database that lives at
 * `${dataDir}/peekgrok.db`. Every domain port is implemented by an
 * adapter in `infra/persistence/`; the `app.js` factory composes them
 * into the same Fastify app the cloud runs.
 *
 * The `db` is passed in by the caller (the peekgrok binary) so this
 * module does not import `bun:sqlite` at the top level — the
 * `apps/api` package stays Node-compatible for its existing test suite.
 *
 * MCP is enabled locally with its SQLite-backed implementations:
 *   - McpAuthRepository   = SqliteInboxRepository (same instance;
 *                           the `inboxes` table gained `mcp_token_hash`)
 *   - RequestSearchReadModel = SqliteMcpRequestSearchReadModel
 *   - McpAuditLog         = SqliteMcpAuditLog (`mcp_audit_log` table)
 *   - McpRateLimiter      = InMemoryMcpRateLimiter (process-local)
 * Other features (SSE, search, fixtures, replay) also use SQLite.
 *
 * @param {{
 *   port: number,
 *   db:   any,           // bun:sqlite Database (caller provides; see file header)
 *   dataDir?: string,    // for log line only; the db handle is already open
 *   webDist?: string,    // absolute path to the built peekhook web app (apps/web/dist)
 *   corsOrigin?: string, // default 'http://localhost:5173' (dev web dev server)
 * }} opts
 * @returns {Promise<import('fastify').FastifyInstance>}
 */
export async function startLocalServer({ port, db, dataDir, webDist, corsOrigin }) {
  // Idempotent migrations. Each adapter exports its own `migrate(db)` so
  // we don't have to know the schema in two places.
  migrateInbox(db)
  migrateCaptured(db)
  migrateReadModel(db)
  migrateSchema(db)
  migrateSearch(db)
  migrateMcpAuditLog(db)

  const inboxRepo = new SqliteInboxRepository(db)
  const mcpAuditLog        = new SqliteMcpAuditLog(db)
  const mcpSearchReadModel = new SqliteMcpRequestSearchReadModel(db)
  const mcpRateLimiter     = new InMemoryMcpRateLimiter()

  // When we serve the inspector SPA on this same origin, its client-side
  // route `/i/:token` collides with the ingest GET-405 guard. Detect that
  // up front so we can tell `buildApp` to skip the guard and let the GET
  // fall through to the SPA fallback below.
  const distPath = webDist ? resolve(webDist) : null
  const willServeSpa = Boolean(distPath && existsSync(join(distPath, 'index.html')))

  const app = await buildApp(
    {
      inboxRepo:           inboxRepo,
      capturedRequestRepo: new SqliteCapturedRequestRepository(db),
      requestReadModel:    new SqliteRequestListReadModel(db),
      schemaRepo:          new SqlitePayloadSchemaRepository(db),
      searchRepo:          new SqliteRegexSearchRepository(db),
      fixtureRepo:         new MemoryFixtureRepository(SEEDED_FIXTURES),
      replayRateLimiter:   getReplayRateLimiter(),
      // Same instance satisfies both InboxRepository and
      // McpAuthRepository — the `inboxes` table gained `mcp_token_hash`
      // and four methods to read/write it.
      mcpAuth:             inboxRepo,
      mcpAuditLog,
      mcpSearchReadModel,
      mcpRateLimiter,
    },
    {
      sseEnabled:   true,
      mcpEnabled:   true,
      shareEnabled: true,
      // Skip the ingest GET-405 guard only when we own the SPA on this
      // origin; otherwise keep the hosted default (guard on).
      ingestGetGuard: !willServeSpa,
    },
  )

  if (corsOrigin) {
    // Override the CORS origin registered by buildApp. The default
    // (http://localhost:5173) is the Vite dev server, which is
    // what peekgrok users will typically pair this with.
    app.log.info(`CORS origin: ${corsOrigin}`)
  }

  if (webDist) {
    if (!willServeSpa) {
      app.log.warn(`webDist has no index.html: ${distPath} — UI will 404 on /`)
    } else {
      // Cache the small dist files in memory at boot. peekhook's
      // built UI is a few hundred KB total; inlining is faster than
      // streaming from disk and avoids needing @fastify/static.
      const MIME = {
        '.html': 'text/html; charset=utf-8',
        '.js':   'application/javascript; charset=utf-8',
        '.mjs':  'application/javascript; charset=utf-8',
        '.css':  'text/css; charset=utf-8',
        '.json': 'application/json; charset=utf-8',
        '.svg':  'image/svg+xml',
        '.png':  'image/png',
        '.ico':  'image/x-icon',
        '.woff': 'font/woff',
        '.woff2':'font/woff2',
        '.map':  'application/json; charset=utf-8',
      }
      const indexHtml = readFileSync(join(distPath, 'index.html'))
      const assetCache = new Map()
      const loadAsset = (rel) => {
        if (assetCache.has(rel)) return assetCache.get(rel)
        const fullPath = join(distPath, rel)
        if (!fullPath.startsWith(distPath)) return null  // path traversal guard
        if (!existsSync(fullPath)) return null
        const stat = statSync(fullPath)
        if (!stat.isFile() || stat.size > 5_000_000) return null  // 5MB cap
        const buf = readFileSync(fullPath)
        assetCache.set(rel, { buf, type: MIME[extname(rel)] ?? 'application/octet-stream' })
        return assetCache.get(rel)
      }

      // Serve /assets/* and other static files. The Vite build emits
      // hashed assets under /assets/; everything else under root is
      // also served as-is (favicon, robots.txt, etc.).
      app.get('/assets/*', (request, reply) => {
        const rel = request.params['*']
        const asset = loadAsset(`assets/${rel}`)
        if (!asset) return reply.code(404).send({ error: 'Not found' })
        return reply.type(asset.type).send(asset.buf)
      })

      // SPA fallback: any GET that doesn't match an API/MCP route serves
      // index.html so the React router can take over. Note `/i/` is NOT
      // excluded here: the capture methods (POST/PUT/PATCH/DELETE) are
      // owned by ingestRoute, so only a GET /i/:token reaches this handler
      // — and that IS the inspector's SPA route (see ingestGetGuard above).
      app.setNotFoundHandler((request, reply) => {
        if (request.method !== 'GET' && request.method !== 'HEAD') {
          return reply.code(404).send({ error: 'Not found' })
        }
        if (request.url.startsWith('/api/') ||
            request.url.startsWith('/mcp')   ||
            request.url.startsWith('/health')) {
          return reply.code(404).send({ error: 'Not found' })
        }
        // Root-level static files (favicon.svg, favicon.ico, robots.txt…)
        // live at the dist root, not under /assets/. Try to serve the
        // requested path as a real file before falling back to the SPA
        // shell — otherwise `/favicon.svg` gets index.html (text/html) and
        // the icon never loads. Real client-side routes (`/i/:token`) have
        // no matching file, so loadAsset returns null and they fall through
        // to index.html as before. `loadAsset` already guards traversal.
        const pathname = request.url.split('?')[0].replace(/^\/+/, '')
        if (pathname && pathname !== 'index.html') {
          const asset = loadAsset(pathname)
          if (asset) return reply.type(asset.type).send(asset.buf)
        }
        return reply.type('text/html; charset=utf-8').send(indexHtml)
      })
    }
  }

  await app.listen({ port, host: '127.0.0.1' })
  app.log.info(`peekgrok local server listening on http://127.0.0.1:${port}`)
  if (dataDir) app.log.info(`data: ${dataDir}/peekgrok.db`)

  return app
}
