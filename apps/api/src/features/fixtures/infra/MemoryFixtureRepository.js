import { FixtureRepository } from '../domain/FixtureRepository.js'
import { Fixture } from '../domain/Fixture.js'

/**
 * In-memory FixtureRepository, seeded from the static modules in
 * `fixtures/`. Each module's plain-object export is validated through
 * `Fixture.create` so a malformed fixture fails fast at boot, not at
 * first request.
 *
 * Lookups are O(1) via a Map built once at construction. Order in
 * `listAll()` matches the order in `fixtures/index.js`, which matches
 * the UI rendering order.
 *
 * @param {Array<object>} rawFixtures — the SEEDED_FIXTURES export from
 *   `fixtures/index.js`. Injected so the test suite can swap fixtures
 *   without monkey-patching the import graph.
 */
export class MemoryFixtureRepository extends FixtureRepository {
  constructor(rawFixtures = []) {
    super()
    this.#byId = new Map()
    for (const raw of rawFixtures) {
      const f = Fixture.create(raw)
      if (this.#byId.has(f.id)) {
        throw new Error(`Fixture id collision: ${f.id}`)
      }
      this.#byId.set(f.id, f)
    }
  }

  #byId

  async listAll() {
    return [...this.#byId.values()]
  }

  async findById(id) {
    return this.#byId.get(id) ?? null
  }
}
