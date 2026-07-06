import Fastify from 'fastify'
import fastifyCors from '@fastify/cors'
import { config } from './config.js'
import { connectDb, closeDb } from './shared/db.js'
import ingestRoute from './infra/http/ingestRoute.js'
import apiRoute from './infra/http/apiRoute.js'

const fastify = Fastify({
  logger: { level: config.isProd ? 'warn' : 'info' },
})

await fastify.register(ingestRoute)
await fastify.register(fastifyCors, {
  origin: process.env.WEB_URL || 'http://localhost:5173',
  credentials: true,
})
await fastify.register(apiRoute)

fastify.get('/health', async () => ({ ok: true }))

try {
  await connectDb()
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
