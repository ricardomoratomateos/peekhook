import { getDb } from '../../../shared/db.js'
import { CaptureRequest } from '../../../app/CaptureRequest.js'
import { MongoInboxRepository } from '../../../infra/persistence/MongoInboxRepository.js'
import { MongoCapturedRequestRepository } from '../../../infra/persistence/MongoCapturedRequestRepository.js'
import { RecordSchema } from '../../schema-history/app/RecordSchema.js'
import { MongoPayloadSchemaRepository } from '../../schema-history/infra/MongoPayloadSchemaRepository.js'
import { MemoryFixtureRepository } from './MemoryFixtureRepository.js'
import { SEEDED_FIXTURES } from '../fixtures/index.js'
import { ListFixtures } from '../app/ListFixtures.js'
import { SendFixture } from '../app/SendFixture.js'

/**
 * HTTP route factory for the fixtures feature.
 *
 * Exposes two endpoints that the orchestrator wires into the API surface:
 *   GET  /api/fixtures
 *     → list fixture metadata (no body content)
 *
 *   POST /api/inboxes/:token/fixtures/:fixtureId
 *     → deliver the fixture through the capture pipeline; returns
 *       `{ ok: true, eventId }` on success, 400 if the fixtureId is
 *       unrecognised, 404 if the inbox no longer exists.
 *
 * Deps are taken via opts for explicit DI (preferred for tests). Both
 * deps have production defaults built from the shared db connection +
 * the static fixtures registry, so the orchestrator can mount the
 * factory with a single `register(fastify)` call — no manual plumbing
 * at the call site.
 *
 * Calling pattern (matches apiRoute.js):
 *
 * ```js
 * // apps/api/src/index.js — wired by the orchestrator, NOT by this PR
 * await fastify.register(registerFixtureRoutes)
 * ```
 *
 * @param {FastifyInstance} fastify
 * @param {{
 *   fixtureRepo?:    import('../domain/FixtureRepository.js').FixtureRepository,
 *   captureRequest?: { execute(cmd): Promise<{ outcome: string, id?: *, responseConfig: null | object }> },
 * } | undefined} opts
 */
export default async function registerFixtureRoutes(fastify, opts = {}) {
  const fixtureRepo    = opts.fixtureRepo    ?? new MemoryFixtureRepository(SEEDED_FIXTURES)
  const captureRequest = opts.captureRequest ?? buildDefaultCaptureRequest()

  const listFixtures = new ListFixtures({ fixtures: fixtureRepo })
  const sendFixture  = new SendFixture({ fixtures: fixtureRepo, captureRequest })

  fastify.get('/api/fixtures', async (request, reply) => {
    const rows = await listFixtures.execute()
    return reply.send(rows)
  })

  fastify.post('/api/inboxes/:token/fixtures/:fixtureId', async (request, reply) => {
    const { token, fixtureId } = request.params

    const result = await sendFixture.execute({ inboxToken: token, fixtureId })

    if (result.outcome === 'fixture_not_found') {
      return reply.code(400).send({ error: 'Fixture not found' })
    }
    if (result.outcome === 'inbox_not_found') {
      return reply.code(404).send({ error: 'Inbox not found' })
    }
    return reply.code(200).send({ ok: true, eventId: result.eventId })
  })
}

function buildDefaultCaptureRequest() {
  const db = getDb()
  return new CaptureRequest({
    inboxes:      new MongoInboxRepository(db),
    requests:     new MongoCapturedRequestRepository(db),
    recordSchema: new RecordSchema({
      schemas: new MongoPayloadSchemaRepository(db),
    }),
  })
}
