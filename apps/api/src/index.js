import { config } from './config.js'
import { connectDb, closeDb, getDb } from './shared/db.js'
import { buildApp } from './app.js'
import { MongoInboxRepository } from './inbox/infra/persistence/MongoInboxRepository.js'
import { MongoCapturedRequestRepository } from './inbox/infra/persistence/MongoCapturedRequestRepository.js'
import { MongoRequestListReadModel } from './inbox/infra/persistence/MongoRequestListReadModel.js'
import { MongoPayloadSchemaRepository } from './schema-history/infra/MongoPayloadSchemaRepository.js'
import { MongoRegexSearchRepository } from './search/infra/MongoRegexSearchRepository.js'
import { MemoryFixtureRepository } from './fixtures/infra/MemoryFixtureRepository.js'
import { SEEDED_FIXTURES } from './fixtures/fixtures/index.js'
import { InMemoryReplayRateLimiter } from './replay/infra/InMemoryReplayRateLimiter.js'
import { MongoMcpAuthRepository } from './mcp/infra/MongoMcpAuthRepository.js'

let singletonRateLimiter

/**
 * Shared process-wide replay rate limiter. Module-level so a
 * single instance survives across requests inside one api process
 * — required for the per-inbox 1/minute semantics to be observable
 * in real traffic. Restart resets state (documented limitation).
 */
function getReplayRateLimiter() {
  if (!singletonRateLimiter) singletonRateLimiter = new InMemoryReplayRateLimiter()
  return singletonRateLimiter
}

try {
  await connectDb()
} catch (err) {
  console.error('MongoDB connect failed:', err.message)
  process.exit(1)
}

const db = getDb()
const app = await buildApp({
  inboxRepo:          new MongoInboxRepository(db),
  capturedRequestRepo: new MongoCapturedRequestRepository(db),
  requestReadModel:   new MongoRequestListReadModel(db),
  schemaRepo:         new MongoPayloadSchemaRepository(db),
  searchRepo:         new MongoRegexSearchRepository(db),
  fixtureRepo:        new MemoryFixtureRepository(SEEDED_FIXTURES),
  replayRateLimiter:  getReplayRateLimiter(),
  mcpAuth:            new MongoMcpAuthRepository(db),
})

try {
  await app.listen({ port: config.port, host: '0.0.0.0' })
  console.log(`peekhook API running on port ${config.port}`)
} catch (err) {
  app.log.error(err)
  process.exit(1)
}

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, async () => {
    await app.close()
    await closeDb()
    process.exit(0)
  })
}
