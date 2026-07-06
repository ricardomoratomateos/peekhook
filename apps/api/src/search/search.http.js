import { getDb } from '../shared/db.js'
import { MongoInboxRepository } from '../inbox/infra/persistence/MongoInboxRepository.js'
import { MongoRegexSearchRepository } from './infra/MongoRegexSearchRepository.js'
import { SearchEvents } from './app/SearchEvents.js'

/**
 * Route handler factory for `GET /api/inboxes/:token/requests/search`.
 *
 * Mounted by the orchestrator alongside the existing routes in
 * `apps/api/src/infra/http/apiRoute.js`. The single-argument factory
 * shape matches Fastify plugin conventions; dependencies are sourced
 * via `getDb()` on each request — same lazy-init pattern that
 * `apiRoute.js` uses — so unit/integration tests can mock the db.
 *
 * Error mapping:
 *   - inbox token not found         → 404 { error }
 *   - use case rejected the query   → 400 { error }
 *   - everything else               → 200 [CapturedRequest DTOs]
 *
 * @param {import('fastify').FastifyInstance} fastify
 */
export async function registerSearchRoutes(fastify) {
  fastify.get('/api/inboxes/:token/requests/search', async (request, reply) => {
    const { token } = request.params
    const { regex, field, limit, before } = request.query

    const db      = getDb()
    const inboxes = new MongoInboxRepository(db)
    const repo    = new MongoRegexSearchRepository(db)
    const search  = new SearchEvents({ repo })

    const inbox = await inboxes.findByToken(token)
    if (!inbox) {
      return reply.code(404).send({ error: 'Inbox not found' })
    }

    let results
    try {
      results = await search.execute({ inboxToken: token, regex, field, limit, before })
    } catch (err) {
      return reply.code(400).send({ error: err.message })
    }

    return reply.send(results)
  })
}

export default registerSearchRoutes
