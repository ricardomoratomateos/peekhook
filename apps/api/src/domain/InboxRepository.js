/**
 * Port: persists and retrieves SandboxInbox aggregates.
 * Implemented by infra (MongoInboxRepository) and by test fakes.
 */
export class InboxRepository {
  /**
   * @param {string} token
   * @returns {Promise<object|null>} the inbox document, or null if not found
   */
  async findByToken(token) {
    throw new Error('InboxRepository.findByToken not implemented')
  }

  /**
   * @param {import('./SandboxInbox.js').SandboxInbox} inbox
   * @returns {Promise<void>}
   */
  async insert(inbox) {
    throw new Error('InboxRepository.insert not implemented')
  }

  /**
   * Set or clear the configured ingest response for a sandbox inbox.
   * Pass `null` to clear (revert to default acknowledgement).
   *
   * @param {string} token
   * @param {null | { enabled: boolean, status: number, contentType: string, body: string }} responseConfig
   * @returns {Promise<void>}
   */
  async updateResponseConfig(token, responseConfig) {
    throw new Error('InboxRepository.updateResponseConfig not implemented')
  }
}
