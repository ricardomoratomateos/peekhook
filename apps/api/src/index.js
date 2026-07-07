import Fastify from 'fastify'
import fastifyCors from '@fastify/cors'
import { config } from './config.js'
import { connectDb, closeDb } from './shared/db.js'
import ingestRoute from './inbox/infra/http/ingestRoute.js'
import apiRoute from './inbox/infra/http/apiRoute.js'
import { registerSearchRoutes } from './search/search.http.js'
import registerFixtureRoutes from './fixtures/infra/fixtures.http.js'
import { registerReplayRoutes } from './replay/infra/replay.http.js'
import { registerMcpRoutes } from './mcp/infra/mcp.http.js'

const fastify = Fastify({
  logger: { level: config.isProd ? 'warn' : 'info' },
  trustProxy: config.trustProxy,
})

try {
  await connectDb()
} catch (err) {
  console.error('MongoDB connect failed:', err.message)
  process.exit(1)
}

await fastify.register(ingestRoute)
await fastify.register(fastifyCors, {
  origin: process.env.WEB_URL || 'http://localhost:5173',
  credentials: true,
})
await fastify.register(apiRoute)
await fastify.register(registerSearchRoutes)
await fastify.register(registerFixtureRoutes)
await fastify.register(registerReplayRoutes)
await fastify.register(registerMcpRoutes)

fastify.get('/health', async () => ({ ok: true }))

try {
  await fastify.listen({ port: config.port, host: '0.0.0.0' })
  console.log(`PeekHook API running on port ${config.port}`)
} catch (err) {
  fastify.log.error(err)
  process.exit(1)
}

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, async () => {
    await fastify.close()
    await closeDb()
    process.exit(0)
  })
}
