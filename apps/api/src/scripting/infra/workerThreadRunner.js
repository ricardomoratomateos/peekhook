import { Worker } from 'node:worker_threads'
import { SCRIPT_DEFAULT_TIMEOUT_MS, ScriptOutcome } from '../domain/ScriptErrors.js'

/**
 * WorkerThreadRunner — script execution port implemented with Node's
 * `worker_threads`. Replaces the previous `node:vm`-only runner.
 *
 * Why a worker thread instead of `node:vm` in the parent process:
 *
 *   - **Hard memory ceiling.** The worker is spawned with
 *     `resourceLimits: { maxOldGenerationSizeMb: 32 }`. An attacker
 *     trying to allocate gigabytes of strings gets the worker killed
 *     by V8 before the parent process is touched. `node:vm` shares the
 *     parent's address space; a runaway script there would consume
 *     the entire Fastify process.
 *   - **Hard wall-clock timeout.** `setTimeout` in the parent calls
 *     `worker.terminate()` after the budget. The worker is killed
 *     regardless of what it's doing (sync infinite loop, blocking
 *     regex, busy wait), so even if the inner `vm.Script` interrupt
 *     misses, the parent still cleans up. A 32 MB isolate can be
 *     spawned in a few ms and torn down in <1 ms.
 *   - **Process isolation.** A crash in user script code (segfault,
 *     uncaught V8 OOM) takes down the worker, never the Fastify
 *     event loop. The parent sees the worker exit with a non-zero
 *     code and reports THREW.
 *   - **Network bypass.** Even though the worker has `http`, `https`,
 *     `net`, `dgram` in its built-ins, the user code runs inside a
 *     `vm.createContext` sandbox where those names are `undefined`.
 *     The defense is at the lexical layer: `require`, `process`,
 *     `fetch`, and friends are non-writable, non-configurable
 *     `undefined` properties on the sandbox, so any reference throws
 *     `ReferenceError` or `TypeError` before reaching a Node API.
 *     `codeGeneration.strings = false` blocks `Function('return process')`
 *     reconstruction via the constructor chain.
 *
 * Behaviour contract (matches `ScriptRunner.RunOutput`):
 *   OK       → `{ outcome: 'ok', body: '<string>' }`
 *   THREW    → `{ outcome: 'threw', error: '<message>' }` for both
 *              compile errors (syntax / illegal token) and runtime
 *              exceptions (ReferenceError, TypeError, …).
 *   TIMEOUT  → `{ outcome: 'timeout' }` if the worker has not posted
 *              its result within the budget. The worker is killed
 *              via `terminate()`; subsequent messages from a zombie
 *              worker are dropped by the `settled` flag below.
 *
 * Lifecycle:
 *   - One worker is spawned per script invocation. The 32 MB / 200 ms
 *     budgets are small enough that re-spawning on every capture
 *     (which already persists to Mongo + sanitizes headers) is
 *     negligible.
 *   - `worker.terminate()` is called in three places to guarantee
 *     no orphan workers: (1) on a normal message, (2) on a worker
 *     error, (3) on the parent-side timeout.
 *   - The worker itself does NOT loop or persist state. Memory
 *     pressure across many captures is bounded by the rate limit
 *     (60/min/inbox token, ROADMAP "Rate limit per token").
 *
 * @param {{ timeoutMs?: number, logger?: { warn: Function } }} [opts]
 */
export class WorkerThreadRunner {
  /**
   * Memory ceiling for the worker isolate, in MB. Matches the user
   * requirement of "spawn node with --max-old-space-size=32" — the
   * worker thread equivalent is `resourceLimits.maxOldGenerationSizeMb`,
   * because `--max-old-space-size` cannot be passed via `execArgv`
   * (Node's execArgv whitelist excludes V8 heap flags).
   */
  static MAX_OLD_GENERATION_MB = 32

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

    const worker = new Worker(new URL('./scriptWorker.js', import.meta.url), {
      workerData: { script, request, timeoutMs: budget },
      resourceLimits: {
        maxOldGenerationSizeMb: WorkerThreadRunner.MAX_OLD_GENERATION_MB,
      },
    })

    return await new Promise((resolve) => {
      let settled = false
      const finish = (result) => {
        if (settled) return
        settled = true
        worker.terminate().catch(() => { /* worker already gone */ })
        resolve(result)
      }

      worker.on('message', (msg) => {
        if (!msg || typeof msg !== 'object') {
          try { this.logger.warn?.('peekhook script worker sent malformed message') } catch (_) {}
          finish({ outcome: ScriptOutcome.THREW, error: 'malformed worker message' })
          return
        }
        if (msg.outcome === ScriptOutcome.OK) {
          finish({ outcome: ScriptOutcome.OK, body: typeof msg.body === 'string' ? msg.body : '' })
        } else if (msg.outcome === ScriptOutcome.TIMEOUT) {
          try { this.logger.warn?.('peekhook script timed out') } catch (_) {}
          finish({ outcome: ScriptOutcome.TIMEOUT })
        } else {
          try { this.logger.warn?.(`peekhook script threw: ${msg.error ?? 'unknown'}`) } catch (_) {}
          finish({ outcome: ScriptOutcome.THREW, error: typeof msg.error === 'string' ? msg.error : 'unknown' })
        }
      })

      worker.on('error', (err) => {
        try { this.logger.warn?.(`peekhook script worker error: ${err.message}`) } catch (_) {}
        finish({ outcome: ScriptOutcome.THREW, error: err && err.message ? err.message : String(err) })
      })

      worker.on('exit', (code) => {
        if (settled) return
        if (code === 0) {
          finish({ outcome: ScriptOutcome.THREW, error: 'worker exited without producing a result' })
        } else {
          finish({ outcome: ScriptOutcome.THREW, error: `worker exited with code ${code}` })
        }
      })

      setTimeout(() => {
        try { this.logger.warn?.(`peekhook script timed out (>${budget}ms), terminating worker`) } catch (_) {}
        finish({ outcome: ScriptOutcome.TIMEOUT })
      }, budget)
    })
  }
}