import Fastify from 'fastify'
import fastifyCors from '@fastify/cors'
import { config } from './config.js'
import { connectDb, closeDb } from './shared/db.js'
import ingestRoute from './infra/http/ingestRoute.js'
import apiRoute from './infra/http/apiRoute.js'
import { registerSearchRoutes } from './features/search/search.http.js'
import registerFixtureRoutes from './features/fixtures/infra/fixtures.http.js'
import { registerReplayRoutes } from './features/replay/infra/replay.http.js'

const fastify = Fastify({
  logger: { level: config.isProd ? 'warn' : 'info' },
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
