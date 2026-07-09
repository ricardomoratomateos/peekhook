import { getDb } from '../../shared/db.js'
import { config } from '../../config.js'
import { MongoInboxRepository }    from '../../inbox/infra/persistence/MongoInboxRepository.js'
import { MongoRequestListReadModel } from '../../inbox/infra/persistence/MongoRequestListReadModel.js'
import { ForwardRequest } from '../../inbox/infra/ForwardRequest.js'
import { runScript } from '../../scripting/index.js'
import { ReplayEvent } from '../app/ReplayEvent.js'
import { ReplayOutcome, REPLAY_HEADER, REPLAY_HEADER_VALUE } from '../domain/ReplayOutcome.js'
import { InMemoryReplayRateLimiter } from './InMemoryReplayRateLimiter.js'

let singletonRateLimiter

/**
 * The forward port for forward-mode replay. Re-sends the (mutated)
 * captured request to the inbox's configured `forwardTo` through the
 * same `ForwardRequest` adapter the live forward feature uses, so the
 * loop guard and hop-by-hop stripping behave identically.
 */
export function replayForward({ targetUrl, method, headers, body }) {
  return new ForwardRequest({
    targetUrl,
    method,
    headers,
    body,
    ingestOrigin: config.ingestUrl,
  }).execute()
}

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

function makeReplayer(fastify) {
  const db = getDb()
  const inboxRepo = fastify.inboxRepo        ?? new MongoInboxRepository(db)
  const readModel = fastify.requestReadModel ?? new MongoRequestListReadModel(db)
  return new ReplayEvent({
    inboxes:     inboxRepo,
    requests:    readModel,
    rateLimiter: getRateLimiter(),
    runScript,
    forward:     replayForward,
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
 * @param {{
 *   replayEvent?:      ReplayEvent,
 *   replayRateLimiter?: import('../domain/ReplayRateLimiter.js').ReplayRateLimiter,
 *   inboxRepo?:        import('../../inbox/domain/InboxRepository.js').InboxRepository,
 *   requestReadModel?: import('../../inbox/domain/RequestListReadModel.js').RequestListReadModel,
 * }} [opts]
 */
export async function registerReplayRoutes(fastify, opts = {}) {
  const replayEvent = opts.replayEvent
    ?? (opts.replayRateLimiter
      ? (() => {
          const db = getDb()
          return new ReplayEvent({
            inboxes:     opts.inboxRepo        ?? new MongoInboxRepository(db),
            requests:    opts.requestReadModel ?? new MongoRequestListReadModel(db),
            rateLimiter: opts.replayRateLimiter,
            runScript,
            forward:     replayForward,
          })
        })()
      : makeReplayer(fastify))

  fastify.post('/api/inboxes/:token/replay', async (request, reply) => {
    const { token } = request.params
    const body      = request.body ?? {}

    if (typeof body.eventId !== 'string' || body.eventId.length === 0) {
      return reply.code(400).send({ error: 'eventId required' })
    }

    // Mode selection: `mode: 'forward'` re-sends to the inbox's
    // configured forwardTo; anything else (including the legacy
    // `mockOnly: true`) replays the mock reply.
    const mode = body.mode === 'forward' ? 'forward' : 'mock'

    const result = await replayEvent.execute({
      inboxToken: token,
      eventId:    body.eventId,
      mode,
      mutations:  body.mutations ?? null,
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
