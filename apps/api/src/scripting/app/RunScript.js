import { ScriptOutcome, SCRIPT_MAX_BYTES } from '../domain/ScriptErrors.js'

/**
 * RunScript — use case for executing a configured mock-reply script.
 *
 * Validates the incoming `script` is a string within the size budget,
 * then delegates execution to a `ScriptRunner` port. Returns the
 * runner's outcome untouched so the transport adapter can:
 *   OK       → reply with the produced body
 *   THREW    → reply 500 { error: 'script threw' }
 *   TIMEOUT  → fall back to the static responseConfig body
 *
 * `INVALID` from validation is reported with `error` so the route layer
 * can map it to HTTP 400 just like ConfigureResponse does.
 *
 * The use case does NOT sanitize script contents. The node:vm adapter is
 * responsible for stripping dangerous globals and enforcing the timeout;
 * this layer is only a boundary check.
 *
 * @param {{
 *   runner: import('../domain/ScriptRunner.js').ScriptRunner,
 * }} deps
 */
export class RunScript {
  constructor({ runner }) {
    this.runner = runner
  }

  /**
   * @param {{
   *   script:    unknown,
   *   request:   import('../domain/ScriptRunner.js').RunInput['request'],
   *   timeoutMs?: number,
   * }} cmd
   * @returns {Promise<{
   *   outcome: 'ok'|'invalid'|'threw'|'timeout',
   *   body?:   string,
   *   error?:  string,
   * }>}
   */
  async execute({ script, request, timeoutMs }) {
    if (typeof script !== 'string') {
      return { outcome: ScriptOutcome.INVALID, error: 'script must be a string' }
    }
    if (Buffer.byteLength(script, 'utf8') > SCRIPT_MAX_BYTES) {
      return { outcome: ScriptOutcome.INVALID, error: 'script exceeds 8 KB limit' }
    }
    if (script.length === 0) {
      return { outcome: ScriptOutcome.INVALID, error: 'script must be non-empty' }
    }

    const result = await this.runner.run({
      script,
      request: {
        method:      String(request?.method ?? ''),
        path:        String(request?.path ?? ''),
        headers:     request?.headers && typeof request.headers === 'object' ? request.headers : {},
        body:        typeof request?.body === 'string' ? request.body : '',
        contentType: String(request?.contentType ?? ''),
        query:       request?.query && typeof request.query === 'object' ? request.query : {},
      },
      timeoutMs,
    })

    if (result.outcome === ScriptOutcome.OK && typeof result.body !== 'string') {
      return { outcome: ScriptOutcome.INVALID, error: 'script return value must be a string' }
    }

    return result
  }
}
