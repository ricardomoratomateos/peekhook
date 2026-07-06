/**
 * SendFixture — command side. Loads the requested Fixture by id and
 * delivers it through the existing CaptureRequest pipeline, so the
 * fixture counts toward the inbox's request list AND its schema-history.
 *
 * The synthetic HTTP request is composed identically to what ingestRoute
 * would have parsed off the wire:
 *   - method      POST
 *   - path        /i/<token>                          (matches an inbound delivery)
 *   - headers     the fixture's full headers, verbatim (X-GitHub-Event etc.
 *                 survive intact, which is what the Inspector demo teaches)
 *   - body        the fixture's pre-stringified body, byte-for-byte
 *   - contentType the first header that looks like a content-type, falling
 *                 back to empty string (same convention as ingestRoute)
 *   - size        the body's UTF-8 byte length
 *   - ip          127.0.0.1 (the request came from inside the API process;
 *                 honest and harmless for the schema-history demo)
 *
 * The CaptureRequest outcome is propagated:
 *   - 'inbox_not_found'   → HTTP 404
 *   - 'fixture_not_found' → HTTP 400  (the user typed a bad id, not a
 *                                         server-side problem)
 *   - 'sent'              → HTTP 200 with `{ ok: true, eventId }`
 *                            (we discard the inbox's responseConfig —
 *                             it's a user-configured mock reply, not
 *                             something to surface to a "send fixture" button)
 *
 * @param {{
 *   fixtures:       import('../domain/FixtureRepository.js').FixtureRepository,
 *   captureRequest: { execute(cmd): Promise<{ outcome: string, id?: *, responseConfig: null | object }> },
 * }} deps
 */
export class SendFixture {
  constructor({ fixtures, captureRequest }) {
    this.fixtures       = fixtures
    this.captureRequest = captureRequest
  }

  /**
   * @param {{ inboxToken: string, fixtureId: string }} cmd
   * @returns {Promise<
   *   | { outcome: 'fixture_not_found' }
   *   | { outcome: 'inbox_not_found' }
   *   | { outcome: 'sent', eventId: string }
   * >}
   */
  async execute({ inboxToken, fixtureId }) {
    if (typeof inboxToken !== 'string' || inboxToken.length === 0) {
      throw new Error('inboxToken required')
    }
    if (typeof fixtureId !== 'string' || fixtureId.length === 0) {
      throw new Error('fixtureId required')
    }

    const fixture = await this.fixtures.findById(fixtureId)
    if (!fixture) return { outcome: 'fixture_not_found' }

    const headers = fixture.headers
    const ctHeader = Object.keys(headers).find((k) => k.toLowerCase() === 'content-type')
    const contentType = ctHeader ? headers[ctHeader] : ''

    const result = await this.captureRequest.execute({
      inboxToken,
      method:      'POST',
      path:        '/i/' + inboxToken,
      query:       {},
      headers,
      body:        fixture.body,
      contentType,
      size:        fixture.bodySize,
      ip:          '127.0.0.1',
    })

    if (result.outcome === 'inbox_not_found') {
      return { outcome: 'inbox_not_found' }
    }

    return { outcome: 'sent', eventId: result.id.toString() }
  }
}
