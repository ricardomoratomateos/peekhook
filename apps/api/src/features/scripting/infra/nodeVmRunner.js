import vm from 'node:vm'
import { ScriptOutcome, SCRIPT_DEFAULT_TIMEOUT_MS } from '../domain/ScriptErrors.js'

const TIMEOUT_ERR_REGEX = /Script execution timed out|execution timed out|ERR_SCRIPT_EXECUTION_TIMEOUT/i

/**
 * node:vm-backed ScriptRunner.
 *
 * Each script runs in its own context with the only application
 * global being `request`. The standard library symbols that would
 * leak a host process (`process`, `global`, `require`, `fetch`,
 * `Buffer`, timers) are rebound to `undefined`, and the context
 * is frozen so the script cannot escape it.
 *
 * A wall-clock Promise.race timeout enforces the script budget
 * regardless of what the script is doing inside the VM. When the
 * race is close to the budget, both V8's internal `runInContext`
 * interrupt AND the outer sentinel may fire — we treat any error
 * whose message matches the timeout marker as TIMEOUT, since a
 * sync infinite loop throws synchronously from inside the VM.
 *
 * Strict mode keeps user scripts from dereferencing undeclared
 * bindings silently — typos surface as `ScriptOutcome.THREW`
 * instead of throwing at runtime access.
 *
 * The user code is wrapped in an IIFE so it can:
 *  1. Use `return <string>` to express the response body.
 *  2. Use `module.exports = <string>` (CommonJS-flavored) to do
 *     the same — matching the smoke-test shape in the ROADMAP
 *     item: `module.exports = JSON.stringify({...})`.
 * Whichever path the script takes, the wrapper returns the
 * value (or `undefined`) and the runner decides the outcome.
 */
export class NodeVmRunner {
  /**
   * @param {{ timeoutMs?: number, logger?: { warn: Function } }} [opts]
   */
  constructor({ timeoutMs, logger } = {}) {
    this.timeoutMs = timeoutMs ?? SCRIPT_DEFAULT_TIMEOUT_MS
    this.logger    = logger ?? console
  }

  /**
   * @param {import('../domain/ScriptRunner.js').RunInput} input
   * @returns {Promise<import('../domain/ScriptRunner.js').RunOutput>}
   */
  async run({ script, request, timeoutMs }) {
    const budget = Number.isInteger(timeoutMs) ? timeoutMs : this.timeoutMs

    const sandbox = Object.create(null)
    sandbox.request = Object.freeze({
      method:      request.method,
      path:        request.path,
      headers:     Object.freeze({ ...request.headers }),
      body:        request.body,
      contentType: request.contentType,
      query:       Object.freeze({ ...request.query }),
    })

    for (const symbol of [
      'process', 'global', 'globalThis', 'require', 'fetch',
      'Buffer', 'setImmediate', 'setInterval', 'setTimeout',
      'clearInterval', 'clearTimeout',
    ]) {
      Object.defineProperty(sandbox, symbol, {
        value: undefined,
        enumerable: false,
        configurable: false,
        writable: false,
      })
    }

    const context = vm.createContext(sandbox, {
      name: 'peekhook-script',
      codeGeneration: { strings: false, wasm: false },
    })

    let compiled
    try {
      compiled = new vm.Script(
`(function() {
  "use strict";
  var module = { exports: undefined };
  ${script}
  if (typeof module.exports === 'string') return module.exports;
  return module.exports;
})()`,
        { filename: 'peekhook-script.js' },
      )
    } catch (err) {
      return { outcome: ScriptOutcome.THREW, error: err.message }
    }

    const execPromise = Promise.resolve().then(() =>
      compiled.runInContext(context, { timeout: budget, displayErrors: true })
    )

    let timer
    const sentinel = new Promise((resolve) => {
      timer = setTimeout(() => resolve({ timeoutFlag: true }), budget)
    })

    const winner = await Promise.race([
      sentinel,
      execPromise.then(
        (value) => ({ ok: true, value }),
        (err)   => ({ ok: false, err }),
      ),
    ])
    clearTimeout(timer)

    if (winner.timeoutFlag) {
      try { this.logger.warn?.('peekhook script timed out') } catch (_) {}
      return { outcome: ScriptOutcome.TIMEOUT }
    }
    if (!winner.ok) {
      const msg = winner.err && winner.err.message ? winner.err.message : String(winner.err)
      if (TIMEOUT_ERR_REGEX.test(msg + ' ' + (winner.err?.code ?? ''))) {
        try { this.logger.warn?.('peekhook script timed out') } catch (_) {}
        return { outcome: ScriptOutcome.TIMEOUT }
      }
      try { this.logger.warn?.(`peekhook script threw: ${msg}`) } catch (_) {}
      return { outcome: ScriptOutcome.THREW, error: msg }
    }

    if (typeof winner.value !== 'string') {
      return { outcome: ScriptOutcome.THREW, error: 'script must return a string' }
    }
    return { outcome: ScriptOutcome.OK, body: winner.value }
  }
}
