import Fastify from 'fastify'
import fastifyCors from '@fastify/cors'

import { config } from './config.js'
import { CaptureRequest } from './inbox/app/CaptureRequest.js'
import { ReplayEvent } from './replay/app/ReplayEvent.js'
import { runScript } from './scripting/index.js'
import { RecordSchema } from './schema-history/app/RecordSchema.js'
import ingestRoute from './inbox/infra/http/ingestRoute.js'
import apiRoute from './inbox/infra/http/apiRoute.js'
import { registerSearchRoutes } from './search/infra/search.http.js'
import registerFixtureRoutes from './fixtures/infra/fixtures.http.js'
import { registerReplayRoutes } from './replay/infra/replay.http.js'
import { registerMcpRoutes } from './mcp/infra/mcp.http.js'
import { InMemoryMcpRateLimiter } from './mcp/infra/InMemoryMcpRateLimiter.js'
import { MongoRequestListReadModel } from './inbox/infra/persistence/MongoRequestListReadModel.js'
import { MongoRequestSearchReadModel } from './mcp/infra/MongoRequestSearchReadModel.js'
import { MongoMcpAuditLog } from './mcp/infra/persistence/MongoMcpAuditLog.js'
import { getDb } from './shared/db.js'

/**
 * buildApp — the Fastify app factory. The cloud entry point
 * (`index.js`) and any future local entry point (`cli.js` for a
 * SQLite-backed mode) call this with their own set of
 * persistence-layer adapters and feature flags.
 *
 * Wiring philosophy:
 *   - The persistence layer is opaque to the routes. Each route
 *     module reads its dependencies off `fastify.<dep>` and falls
 *     back to a `getDb()`-sourced Mongo adapter when no decorator
 *     is present. This keeps the existing test suite (which
 *     registers routes without decorating) working without a
 *     rewrite, and means an entry point only has to wire the deps
 *     it actually wants to swap.
 *   - Feature flags are exposed on `fastify.features` so routes
 *     can gate registration on them (e.g. share endpoint, MCP
 *     token mint) without re-reading env vars at request time.
 *   - The factory is intentionally additive: registering a new
 *     route module is a one-liner, and registering a new dep is
 *     a one-liner. No central registry to maintain.
 *
 * @param {{
 *   inboxRepo?:           import('./inbox/domain/InboxRepository.js').InboxRepository,
 *   capturedRequestRepo?: import('./inbox/domain/CapturedRequestRepository.js').CapturedRequestRepository,
 *   requestReadModel?:    import('./inbox/domain/RequestListReadModel.js').RequestListReadModel,
 *   schemaRepo?:          import('./schema-history/domain/PayloadSchemaRepository.js').PayloadSchemaRepository,
 *   searchRepo?:          import('./search/domain/SearchEventsRepository.js').SearchEventsRepository,
 *   fixtureRepo?:         import('./fixtures/domain/FixtureRepository.js').FixtureRepository,
 *   replayRateLimiter?:   import('./replay/domain/ReplayRateLimiter.js').ReplayRateLimiter,
 *   mcpAuth?:             import('./mcp/domain/McpAuthRepository.js').McpAuthRepository,
 *   mcpAuditLog?:         import('./mcp/domain/McpAuditLog.js').McpAuditLog,
 *   mcpSearchReadModel?:  import('./mcp/domain/RequestSearchReadModel.js').RequestSearchReadModel,
 *   mcpRateLimiter?:      import('./mcp/domain/McpRateLimiter.js').McpRateLimiter,
 * }} deps  Persistence-layer adapters. When `mcpAuth` is set but the
 *   remaining four MCP deps are not, the factory falls back to
 *   `getDb()`-sourced Mongo adapters so the cloud entry (`index.js`,
 *   unchanged) keeps working. The local SQLite entry (`cli.js`)
 *   passes every MCP adapter explicitly, so the fallbacks never run
 *   on that path. Other routes fall back to `getDb()` only when no
 *   decorator is registered.
 * @param {{
 *   sseEnabled?:   boolean,  // default true
 *   mcpEnabled?:   boolean,  // default true
 *   shareEnabled?: boolean,  // default true
 * }} [options] Feature flags. Missing flags default to enabled.
 *   `sseEnabled=false` skips the live stream route; `mcpEnabled=false`
 *   skips the `POST /mcp` route; `shareEnabled=false` skips the
 *   `POST /api/inboxes/:token/requests/:id/share` endpoint.
 * @returns {Promise<import('fastify').FastifyInstance>}
 */
export async function buildApp(deps, options = {}) {
  const app = Fastify({
    logger: { level: config.isProd ? 'warn' : 'info' },
    trustProxy: config.trustProxy,
  })

  if (deps.inboxRepo)           app.decorate('inboxRepo',          deps.inboxRepo)
  if (deps.capturedRequestRepo) app.decorate('capturedRequestRepo', deps.capturedRequestRepo)
  if (deps.requestReadModel)    app.decorate('requestReadModel',    deps.requestReadModel)
  if (deps.schemaRepo)          app.decorate('schemaRepo',          deps.schemaRepo)
  if (deps.searchRepo)          app.decorate('searchRepo',          deps.searchRepo)
  if (deps.fixtureRepo)         app.decorate('fixtureRepo',         deps.fixtureRepo)
  if (deps.replayRateLimiter)   app.decorate('replayRateLimiter',   deps.replayRateLimiter)
  if (deps.mcpAuth)             app.decorate('mcpAuth',             deps.mcpAuth)
  if (deps.mcpAuditLog)         app.decorate('mcpAuditLog',         deps.mcpAuditLog)
  if (deps.mcpSearchReadModel)  app.decorate('mcpSearchReadModel',  deps.mcpSearchReadModel)
  if (deps.mcpRateLimiter)      app.decorate('mcpRateLimiter',      deps.mcpRateLimiter)

  app.decorate('features', options)

  await app.register(fastifyCors, {
    origin: process.env.WEB_URL || 'http://localhost:5173',
    credentials: true,
  })

  // Construct the shared capture use case from the inbox/requests/schema
  // repos. The fixtures route (and the SSE stream) both need it; building
  // it here means the route modules never have to fall back to `getDb()`
  // to find their dependencies.
  const captureRequest = (deps.inboxRepo && deps.capturedRequestRepo && deps.schemaRepo)
    ? new CaptureRequest({
        inboxes:      deps.inboxRepo,
        requests:     deps.capturedRequestRepo,
        recordSchema: new RecordSchema({ schemas: deps.schemaRepo }),
      })
    : null

  // Same for ReplayEvent — the replay route's default branch reads
  // `getDb()` at registration time, which breaks the local SQLite
  // entry. Pass a pre-built use case so the route never falls back.
  const replayEvent = (deps.inboxRepo && deps.requestReadModel && deps.replayRateLimiter)
    ? new ReplayEvent({
        inboxes:     deps.inboxRepo,
        requests:    deps.requestReadModel,
        rateLimiter: deps.replayRateLimiter,
        runScript,
      })
    : null

  await app.register(ingestRoute)
  await app.register(apiRoute)

  await app.register(registerSearchRoutes, {
    inboxRepo:  deps.inboxRepo,
    searchRepo: deps.searchRepo,
  })

  await app.register(registerFixtureRoutes, {
    fixtureRepo:    deps.fixtureRepo,
    captureRequest,
  })

  await app.register(registerReplayRoutes, {
    replayEvent,
    replayRateLimiter: deps.replayRateLimiter,
    inboxRepo:         deps.inboxRepo,
    requestReadModel:  deps.requestReadModel,
  })

  if (options.mcpEnabled !== false && deps.mcpAuth) {
    // The MCP route (`mcp.http.js`) requires all five MCP deps at
    // registration time — no implicit fallbacks. The cloud entry
    // (`index.js`) historically only passed `mcpAuth`, so the factory
    // constructs the remaining three from Mongo here. The local
    // SQLite entry (`cli.js`) passes every adapter explicitly, so
    // these fallbacks never run on that path.
    let db
    if (!deps.requestReadModel || !deps.mcpSearchReadModel || !deps.mcpAuditLog || !deps.mcpRateLimiter) {
      db = getDb()
    }
    const requestReadModel   = deps.requestReadModel   ?? new MongoRequestListReadModel(db)
    const mcpSearchReadModel = deps.mcpSearchReadModel ?? new MongoRequestSearchReadModel(db)
    const mcpAuditLog        = deps.mcpAuditLog        ?? new MongoMcpAuditLog(db)
    const mcpRateLimiter     = deps.mcpRateLimiter     ?? new InMemoryMcpRateLimiter()

    await app.register(registerMcpRoutes, {
      mcpAuth:            deps.mcpAuth,
      requestReadModel,
      mcpSearchReadModel,
      mcpAuditLog,
      mcpRateLimiter,
    })
  }

  app.get('/health', async () => ({ ok: true }))

  return app
}

export default buildApp
