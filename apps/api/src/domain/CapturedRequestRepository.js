/**
 * Port: mints ids and persists CapturedRequest aggregates.
 * The id is allocated up-front so the use case can return it before
 * the aggregate is written.
 */
export class CapturedRequestRepository {
  /** @returns {*} a fresh, store-native request id */
  nextId() {
    throw new Error('CapturedRequestRepository.nextId not implemented')
  }

  /**
   * @param {import('./CapturedRequest.js').CapturedRequest} req
   * @returns {Promise<void>}
   */
  async insert(req) {
    throw new Error('CapturedRequestRepository.insert not implemented')
  }
}
