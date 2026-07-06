import { SCRIPT_DEFAULT_TIMEOUT_MS } from './ScriptErrors.js'

/**
 * Port: executes a user-supplied JS string in a sandbox and returns the
 * outcome plus the produced body (or a short error description).
 *
 * Adapters live in `infra/` (currently `infra/nodeVmRunner.js`).
 * The contract is intentionally narrow — exactly what the ingest route
 * needs to decide between the scripted reply, the static fallback,
 * and a 500 script-threw response.
 *
 * @typedef {{
 *   method: string,
 *   path: string,
 *   headers: object,
 *   body: string,
 *   contentType: string,
 *   query: object,
 * }} ScriptRequest
 *
 * @typedef {{
 *   script:    string,
 *   request:   ScriptRequest,
 *   timeoutMs?: number,
 * }} RunInput
 *
 * @typedef {{
 *   outcome: 'ok'|'threw'|'timeout',
 *   body?:   string,
 *   error?:  string,
 * }} RunOutput
 */
export class ScriptRunner {
  /**
   * @param {RunInput} _input
   * @returns {Promise<RunOutput>}
   */
  async run(_input) {
    throw new Error('ScriptRunner.run not implemented')
  }
}

export const DEFAULT_SCRIPT_TIMEOUT_MS = SCRIPT_DEFAULT_TIMEOUT_MS
