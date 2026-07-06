/**
 * Port: read-only view of the Fixture catalogue. The README on ROADMAP #11
 * says fixtures live as static modules today. Defining the port here means
 * the infra swap to a DB-backed fixture catalogue (or a remote registry)
 * is a drop-in change — no use case touches.
 *
 * Implemented today by `MemoryFixtureRepository`, which hydrates from the
 * `fixtures/` subdirectory. Tests pass plain object fakes.
 */
export class FixtureRepository {
  /** @returns {Promise<Array<import('./Fixture.js').Fixture>>} */
  async listAll() {
    throw new Error('FixtureRepository.listAll not implemented')
  }

  /**
   * @param {string} id
   * @returns {Promise<import('./Fixture.js').Fixture | null>}
   */
  async findById(id) {
    throw new Error('FixtureRepository.findById not implemented')
  }
}
