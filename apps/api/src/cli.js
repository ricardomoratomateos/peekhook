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

  // In CLI/local mode the same Fastify serves both the API and the
  // SPA, so we read the built `index.html` up front and decorate the
  // app with it. The `GET /i/*` route (see `ingestRoute.js`) checks
  // for this decoration and serves the SPA instead of the hosted
  // 405. The root `/` path is also served from this buffer, with an
  // auto-mint script prepended (see `rootIndexHtml` below) so
  // `peekgrok` users land directly in a fresh inbox.
  const spaIndexHtml = webDist && existsSync(resolve(webDist))
    ? readFileSync(join(resolve(webDist), 'index.html'))
    : null
  const AUTO_MINT_SCRIPT = `<script>(function(){try{var s=document.createElement('style');s.id='peekhook-cli-hide';s.textContent='html{background:#0a0a0a}body{visibility:hidden}';(document.head||document.documentElement).appendChild(s)}catch(_){}fetch('/api/inboxes',{method:'POST'}).then(function(r){if(!r.ok)throw new Error('http '+r.status);return r.json()}).then(function(inbox){try{localStorage.setItem('peekhook-'+inbox.token,JSON.stringify({url:inbox.url,expiresAt:inbox.expiresAt,mcpToken:inbox.mcp_token}))}catch(_){}window.location.replace('/i/'+inbox.token)}).catch(function(){var s=document.getElementById('peekhook-cli-hide');if(s)s.remove()})})();</script>`
  const rootIndexHtml = spaIndexHtml
    ? Buffer.from(spaIndexHtml.toString('utf8').replace(/<head>/i, '<head>' + AUTO_MINT_SCRIPT))
    : null

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
      sseEnabled:      true,
      mcpEnabled:      true,
      shareEnabled:    true,
      cliInspectorSpa: spaIndexHtml,
    },
  )

  if (corsOrigin) {
    // Override the CORS origin registered by buildApp. The default
    // (http://localhost:5173) is the Vite dev server, which is
    // what peekgrok users will typically pair this with.
    app.log.info(`CORS origin: ${corsOrigin}`)
  }

  if (webDist) {
    const distPath = resolve(webDist)
    if (!existsSync(distPath)) {
      app.log.warn(`webDist path does not exist: ${distPath} — UI will 404 on /`)
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

      // SPA fallback: any GET that doesn't match an API/ingest/MCP
      // route serves index.html so the React router can take over.
      // `/` gets the auto-mint variant (so the CLI user lands in a
      // fresh inbox) and every other path gets the plain SPA.
      app.setNotFoundHandler((request, reply) => {
        if (request.method !== 'GET' && request.method !== 'HEAD') {
          return reply.code(404).send({ error: 'Not found' })
        }
        if (request.url.startsWith('/api/') ||
            request.url.startsWith('/i/')    ||
            request.url.startsWith('/mcp')   ||
            request.url.startsWith('/health')) {
          return reply.code(404).send({ error: 'Not found' })
        }
        // Root-level static files (favicon.svg, favicon.ico, robots.txt…)
        // live at the dist root, not under /assets/. Try to serve the
        // requested path as a real file before falling back to the SPA
        // shell — otherwise `/favicon.svg` gets index.html (text/html) and
        // the icon never loads. Real client-side routes have no matching
        // file, so loadAsset returns null and they fall through. `loadAsset`
        // already guards traversal.
        const pathname = request.url.split('?')[0].replace(/^\/+/, '')
        if (pathname && pathname !== 'index.html') {
          const asset = loadAsset(pathname)
          if (asset) return reply.type(asset.type).send(asset.buf)
        }
        if (request.url === '/' && rootIndexHtml) {
          return reply.type('text/html; charset=utf-8').send(rootIndexHtml)
        }
        if (spaIndexHtml) {
          return reply.type('text/html; charset=utf-8').send(spaIndexHtml)
        }
        return reply.code(404).send({ error: 'Not found' })
      })
    }
  }

  await app.listen({ port, host: '127.0.0.1' })
  app.log.info(`peekgrok local server listening on http://127.0.0.1:${port}`)
  if (dataDir) app.log.info(`data: ${dataDir}/peekgrok.db`)

  return app
}
