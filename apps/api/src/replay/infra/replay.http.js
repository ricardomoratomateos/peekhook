import { getDb } from '../../shared/db.js'
import { MongoInboxRepository }    from '../../inbox/infra/persistence/MongoInboxRepository.js'
import { MongoRequestListReadModel } from '../../inbox/infra/persistence/MongoRequestListReadModel.js'
import { runScript } from '../../scripting/index.js'
import { ReplayEvent } from '../app/ReplayEvent.js'
import { ReplayOutcome, REPLAY_HEADER, REPLAY_HEADER_VALUE } from '../domain/ReplayOutcome.js'
import { InMemoryReplayRateLimiter } from './InMemoryReplayRateLimiter.js'

let singletonRateLimiter

/**
 * Shared process-wide rate limiter. Module-level so a single
 * instance survives across requests inside one api process —
 * required for the per-inbox 1/minute semantics to be observable
 * in real traffic. Restart resets state (documented limitation).
 */
export function getRateLimiter() {
  if (!singletonRateLimiter) singletonRateLimiter = new InMemoryReplayRateLimiter()
  return singletonRateLimiter
}

function makeReplayer() {
  const db = getDb()
  return new ReplayEvent({
    inboxes:     new MongoInboxRepository(db),
    requests:    new MongoRequestListReadModel(db),
    rateLimiter: getRateLimiter(),
    runScript,
  })
}

/**
 * Registers `POST /api/inboxes/:token/replay` on `fastify`.
 *
 * With no opts, dependencies are wired from `getDb()` and the
 * shared rate limiter singleton — this matches the production
 * compose path inside `apps/api/src/index.js`.
 *
 * Tests pass `opts.replayEvent` to inject a fully constructed
 * use case (often with the real Mongo repos but a freshly minted
 * in-memory limiter) so each test starts with a clean bucket.
 *
 * @param {import('fastify').FastifyInstance} fastify
 * @param {{ replayEvent?: ReplayEvent }}      [opts]
 */
export async function registerReplayRoutes(fastify, opts = {}) {
  const replayEvent = opts.replayEvent ?? makeReplayer()

  fastify.post('/api/inboxes/:token/replay', async (request, reply) => {
    const { token } = request.params
    const body      = request.body ?? {}

    if (typeof body.eventId !== 'string' || body.eventId.length === 0) {
      return reply.code(400).send({ error: 'eventId required' })
    }
    if (body.mockOnly !== true) {
      return reply.code(400).send({
        error: 'mockOnly must be true: external URL replay is gated on inbox claim',
      })
    }

    const result = await replayEvent.execute({
      inboxToken: token,
      eventId:    body.eventId,
      mockOnly:   true,
    })

    if (result.outcome === ReplayOutcome.RATE_LIMITED) {
      const retryAfterSec = result.retryAfterSec ?? 60
      return reply
        .code(429)
        .header('Retry-After', String(retryAfterSec))
        .header(REPLAY_HEADER, REPLAY_HEADER_VALUE)
        .send({ error: 'rate limit exceeded', retryAfterSec })
    }

    if (result.outcome === ReplayOutcome.NOT_FOUND) {
      return reply.code(404).send({ error: 'inbox or event not found' })
    }

    if (result.outcome === ReplayOutcome.INVALID) {
      return reply.code(400).send({ error: result.error ?? 'invalid' })
    }

    const target = result.target.toDto()
    return reply
      .code(200)
      .header(REPLAY_HEADER, REPLAY_HEADER_VALUE)
      .send({
        token,
        replayed: {
          ...target,
          headers:    { [REPLAY_HEADER]: REPLAY_HEADER_VALUE },
          replayedAt: result.replayedAt,
        },
      })
  })
}

export default registerReplayRoutes
