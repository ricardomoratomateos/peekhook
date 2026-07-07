/**
 * Worker thread sandbox runner — the script execution half of the
 * "node:vm → worker thread" security migration (ROADMAP "Sandbox
 * isolation: worker thread").
 *
 * This file is loaded by `WorkerThreadRunner` inside a Node
 * `worker_thread`. It runs OUTSIDE the Fastify event loop, in its
 * own isolate, with a hard memory ceiling (`resourceLimits.maxOldGenerationSizeMb = 32`)
 * and a hard wall-clock timeout (`worker.terminate()` from the parent).
 *
 * The shape is intentionally identical to the legacy `node:vm` runner:
 *   - Strict mode wrapper so user typos surface immediately
 *   - CommonJS-flavored `module.exports = <string>` AND `return <string>`
 *     both work — the wrapper inspects `module.exports` after the script
 *     runs and returns it if it's a string
 *   - Network-bypass prevention: every dangerous global is `undefined`
 *     inside the VM context (`process`, `global`, `globalThis`,
 *     `require`, `fetch`, `Buffer`, the timer family)
 *   - Code-generation from strings is disabled (`codeGeneration.strings = false`,
 *     `codeGeneration.wasm = false`) so an attacker can't recover
 *     `Function('return process')` via the constructor chain
 *   - `runInContext` carries its own internal `timeout` (a separate
 *     defense-in-depth; the parent's `worker.terminate()` is the
 *     hard cutoff)
 *
 * On any failure, the worker posts a single `{ outcome, body?, error? }`
 * message and exits. The parent (`WorkerThreadRunner`) is the only
 * thing that decides between OK / THREW / TIMEOUT and converts
 * worker errors into the `ScriptRunner` contract.
 */
import { parentPort, workerData } from 'node:worker_threads'
import vm from 'node:vm'

const { script, request, timeoutMs } = workerData

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
  parentPort.postMessage({ outcome: 'threw', error: err.message })
  process.exit(0)
}

const TIMEOUT_ERR_REGEX = /Script execution timed out|execution timed out|ERR_SCRIPT_EXECUTION_TIMEOUT/i

try {
  const value = compiled.runInContext(context, { timeout: timeoutMs, displayErrors: true })
  if (typeof value !== 'string') {
    parentPort.postMessage({ outcome: 'threw', error: 'script must return a string' })
  } else {
    parentPort.postMessage({ outcome: 'ok', body: value })
  }
} catch (err) {
  const msg = err && err.message ? err.message : String(err)
  if (TIMEOUT_ERR_REGEX.test(msg)) {
    parentPort.postMessage({ outcome: 'timeout' })
  } else {
    parentPort.postMessage({ outcome: 'threw', error: msg })
  }
}