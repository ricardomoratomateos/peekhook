/**
 * Outcomes for the ScriptRunner port and the RunScript use case.
 *
 *   OK       – script executed and returned a string body
 *   INVALID  – script is not a string or exceeded the 8 KB size budget
 *   THREW    – script raised an exception inside the sandbox
 *   TIMEOUT  – script did not finish within the enforced time budget
 */
export const ScriptOutcome = Object.freeze({
  OK:      'ok',
  INVALID: 'invalid',
  THREW:   'threw',
  TIMEOUT: 'timeout',
})

export const SCRIPT_MAX_BYTES = 8 * 1024
export const SCRIPT_DEFAULT_TIMEOUT_MS = 200
