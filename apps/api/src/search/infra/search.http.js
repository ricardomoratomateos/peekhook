import { getDb } from '../../shared/db.js'
import { MongoInboxRepository } from '../../inbox/infra/persistence/MongoInboxRepository.js'
import { MongoRegexSearchRepository } from './MongoRegexSearchRepository.js'
import { SearchEvents } from '../app/SearchEvents.js'

/**
 * Route handler factory for `GET /api/inboxes/:token/requests/search`.
 *
 * Mounted by the orchestrator (`buildApp`) alongside the existing
 * routes in `apps/api/src/infra/http/apiRoute.js`. The
 * two-argument factory shape matches Fastify plugin conventions;
 * dependencies are sourced in this order:
 *   1. Explicit `opts.<dep>` (preferred path; production wires
 *      this in `buildApp`).
 *   2. `fastify.<dep>` decoration (defensive; same source as opts).
 *   3. A fresh `getDb()`-sourced Mongo adapter (test path; matches
 *      the existing `vi.mock('../shared/db.js')` pattern).
 *
 * Error mapping:
 *   - inbox token not found         → 404 { error }
 *   - use case rejected the query   → 400 { error }
 *   - everything else               → 200 [CapturedRequest DTOs]
 *
 * @param {import('fastify').FastifyInstance} fastify
 * @param {{
 *   inboxRepo?: import('../inbox/domain/InboxRepository.js').InboxRepository,
 *   searchRepo?: import('./domain/SearchEventsRepository.js').SearchEventsRepository,
 * }} [opts]
 */
export async function registerSearchRoutes(fastify, opts = {}) {
  fastify.get('/api/inboxes/:token/requests/search', async (request, reply) => {
    const { token } = request.params
    const { regex, field, limit, before } = request.query

    // Resolve deps dep-first; only touch getDb() when one is actually
    // missing. Calling getDb() eagerly threw "DB not initialized" on the
    // SQLite target (peekgrok never calls connectDb), 500-ing every search
    // even though searchRepo was correctly injected.
    const inboxRepo = opts.inboxRepo  ?? fastify.inboxRepo
    const searchRepo = opts.searchRepo ?? fastify.searchRepo
    const db      = (!inboxRepo || !searchRepo) ? getDb() : null
    const inboxes = inboxRepo  ?? new MongoInboxRepository(db)
    const repo    = searchRepo ?? new MongoRegexSearchRepository(db)
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
