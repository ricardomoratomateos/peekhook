/**
 * ListFixtures — query side for the Inspector menu.
 *
 * Returns metadata only (no body, no headers) — preview is rendered on the
 * frontend. The per-fixture byte size is included so the menu can show a
 * compact "1.2 kb" hint without a second round-trip.
 *
 * Returns `[]` (not null) when the repository is empty; the frontend can
 * skip a null check.
 *
 * @param {{
 *   fixtures: import('../domain/FixtureRepository.js').FixtureRepository,
 * }} deps
 */
export class ListFixtures {
  constructor({ fixtures }) {
    this.fixtures = fixtures
  }

  /**
   * @returns {Promise<Array<{id, name, provider, label, body_size}>>}
   */
  async execute() {
    const all = await this.fixtures.listAll()
    return all.map((f) => f.toListDto())
  }
}
