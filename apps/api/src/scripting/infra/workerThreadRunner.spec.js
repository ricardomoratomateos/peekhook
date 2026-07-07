import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { WorkerThreadRunner } from './workerThreadRunner.js'
import { ScriptOutcome, SCRIPT_DEFAULT_TIMEOUT_MS } from '../domain/ScriptErrors.js'

/**
 * Worker-thread security tests. Each script below is a known
 * sandbox-escape attempt; the runner must contain it (THREW or
 * TIMEOUT) without leaking any host primitives.
 *
 * The runner spawns one `worker_threads.Worker` per invocation,
 * with `resourceLimits.maxOldGenerationSizeMb = 32` and a hard
 * `worker.terminate()` from the parent after the timeout. The
 * inner VM context also strips process / require / fetch / Buffer /
 * timers, and disables string code-generation so the constructor
 * chain (`Function('return process')`) cannot reconstruct them.
 *
 * Test budget note: the timeout test runs in real wall-clock time
 * (`timeoutMs = 200`). The other tests run fast (<50 ms) because
 * a ReferenceError from a missing global is synchronous.
 */

const dummyRequest = Object.freeze({
  method:      'POST',
  path:        '/i/test',
  headers:     Object.freeze({ 'content-type': 'application/json' }),
  body:        '{"event":"test"}',
  contentType: 'application/json',
  query:       Object.freeze({}),
})

describe('WorkerThreadRunner — sandbox escape containment', () => {
  const runner = new WorkerThreadRunner()

  it('exposes the documented 200ms default budget', () => {
    expect(SCRIPT_DEFAULT_TIMEOUT_MS).toBe(200)
    expect(runner.timeoutMs).toBe(200)
  })

  it('exposes the documented 32 MB heap ceiling as a class constant', () => {
    expect(WorkerThreadRunner.MAX_OLD_GENERATION_MB).toBe(32)
  })

  it('returns OK + the produced body for a clean script', async () => {
    const result = await runner.run({
      script: 'return JSON.stringify({ echo: request.body })',
      request: dummyRequest,
    })
    expect(result.outcome).toBe(ScriptOutcome.OK)
    expect(result.body).toBe('{"echo":"{\\"event\\":\\"test\\"}"}')
  })

  it('supports the CommonJS-flavoured module.exports shape', async () => {
    const result = await runner.run({
      script: 'module.exports = "hi"',
      request: dummyRequest,
    })
    expect(result.outcome).toBe(ScriptOutcome.OK)
    expect(result.body).toBe('hi')
  })

  it('reports THREW when the script returns a non-string value', async () => {
    const result = await runner.run({
      script: 'return 12345',
      request: dummyRequest,
    })
    expect(result.outcome).toBe(ScriptOutcome.THREW)
    expect(result.error).toMatch(/string/)
  })

  it('reports THREW when the script throws a regular exception', async () => {
    const result = await runner.run({
      script: 'throw new Error("boom")',
      request: dummyRequest,
    })
    expect(result.outcome).toBe(ScriptOutcome.THREW)
    expect(result.error).toMatch(/boom/)
  })

  /**
   * Escape attempt 1: classic constructor-chain trick to recover
   * `Function` and then eval `return process`. The `codeGeneration.strings = false`
   * option on the VM context blocks `new Function('return process')`
   * at the source, so the script never gets to call `process.exit`.
   */
  it('blocks this.constructor.constructor("return process")().exit(0)', async () => {
    const script = `var F = this.constructor.constructor;
      F('return process')().exit(0);
      return "should not reach"`
    const result = await runner.run({ script, request: dummyRequest })
    expect(result.outcome).toBe(ScriptOutcome.THREW)
  })

  /**
   * Escape attempt 2: direct `process.exit(0)` reference. `process`
   * is `undefined` in the sandbox so the very first dereference
   * throws ReferenceError → THREW.
   */
  it('blocks process.exit(0) (direct reference)', async () => {
    const result = await runner.run({
      script: 'process.exit(0); return "should not reach"',
      request: dummyRequest,
    })
    expect(result.outcome).toBe(ScriptOutcome.THREW)
    expect(result.error).toMatch(/undefined|Cannot read/i)
  })

  /**
   * Escape attempt 3: process.binding('fs') — Node-specific call
   * that reaches the underlying libuv file ops. Blocked at the
   * global binding step.
   */
  it('blocks process.binding("fs")', async () => {
    const result = await runner.run({
      script: `process.binding('fs'); return "should not reach"`,
      request: dummyRequest,
    })
    expect(result.outcome).toBe(ScriptOutcome.THREW)
  })

  /**
   * Escape attempt 4: prototype chain traversal to mainModule +
   * require('fs'). Blocked at the `globalThis.process` step.
   */
  it('blocks globalThis.process.mainModule.require("fs")', async () => {
    const result = await runner.run({
      script: `globalThis.process.mainModule.require('fs'); return "should not reach"`,
      request: dummyRequest,
    })
    expect(result.outcome).toBe(ScriptOutcome.THREW)
  })

  /**
   * Escape attempt 5: a bare `require('fs')` reference. `require`
   * is `undefined` in the sandbox.
   */
  it('blocks require("fs")', async () => {
    const result = await runner.run({
      script: `require('fs'); return "should not reach"`,
      request: dummyRequest,
    })
    expect(result.outcome).toBe(ScriptOutcome.THREW)
    expect(result.error).toMatch(/require is not a function/)
  })

  /**
   * Escape attempt 6: direct `fetch` reference (Node 18+ global).
   */
  it('blocks fetch("http://evil.example")', async () => {
    const result = await runner.run({
      script: `fetch('http://evil.example'); return "should not reach"`,
      request: dummyRequest,
    })
    expect(result.outcome).toBe(ScriptOutcome.THREW)
    expect(result.error).toMatch(/fetch is not a function/)
  })

  /**
   * Escape attempt 7: dynamic import. `import` is not defined as a
   * keyword in a vm.Script (only in modules), and `await` outside
   * an async function is a SyntaxError. Either way the script is
   * rejected before any network code runs.
   */
  it('blocks await import("http")', async () => {
    const result = await runner.run({
      script: `await import('http'); return "should not reach"`,
      request: dummyRequest,
    })
    expect(result.outcome).toBe(ScriptOutcome.THREW)
  })

  /**
   * Escape attempt 8: reference to `http` directly (no `require`).
   * `http` is not a global in the sandbox.
   */
  it('blocks http.get("http://evil.example")', async () => {
    const result = await runner.run({
      script: `http.get('http://evil.example'); return "should not reach"`,
      request: dummyRequest,
    })
    expect(result.outcome).toBe(ScriptOutcome.THREW)
    expect(result.error).toMatch(/http is not defined/)
  })

  /**
   * Escape attempt 9: `https` module reference.
   */
  it('blocks https.request(...)', async () => {
    const result = await runner.run({
      script: `https.request({}); return "should not reach"`,
      request: dummyRequest,
    })
    expect(result.outcome).toBe(ScriptOutcome.THREW)
    expect(result.error).toMatch(/https is not defined/)
  })

  /**
   * Escape attempt 10: `net` module reference.
   */
  it('blocks net.connect(...)', async () => {
    const result = await runner.run({
      script: `net.connect(); return "should not reach"`,
      request: dummyRequest,
    })
    expect(result.outcome).toBe(ScriptOutcome.THREW)
    expect(result.error).toMatch(/net is not defined/)
  })

  /**
   * Escape attempt 11: `dgram` module reference.
   */
  it('blocks dgram.createSocket(...)', async () => {
    const result = await runner.run({
      script: `dgram.createSocket(); return "should not reach"`,
      request: dummyRequest,
    })
    expect(result.outcome).toBe(ScriptOutcome.THREW)
    expect(result.error).toMatch(/dgram is not defined/)
  })

  /**
   * Escape attempt 12: `Buffer` global (lets an attacker allocate
   * arbitrary memory via Node's fast allocator). The worker does
   * cap memory via `resourceLimits`, but defense-in-depth at the
   * lexical layer also makes `Buffer` unreachable.
   */
  it('blocks Buffer.alloc(1<<24)', async () => {
    const result = await runner.run({
      script: `Buffer.alloc(1 << 24); return "should not reach"`,
      request: dummyRequest,
    })
    expect(result.outcome).toBe(ScriptOutcome.THREW)
    expect(result.error).toMatch(/Buffer is not a constructor|undefined/i)
  })

  /**
   * Escape attempt 13: `setTimeout` to defer an escape attempt past
   * the parent's wall-clock timeout. `setTimeout` is undefined, so
   * this is rejected immediately. Even if it weren't, the parent
   * would `worker.terminate()` the worker after the budget anyway.
   */
  it('blocks setTimeout(() => process.exit(0), 1000)', async () => {
    const result = await runner.run({
      script: `setTimeout(() => process.exit(0), 1000); return "scheduled"`,
      request: dummyRequest,
    })
    expect(result.outcome).toBe(ScriptOutcome.THREW)
  })

  /**
   * Escape attempt 14: tight CPU loop. The parent's
   * `setTimeout → worker.terminate()` is the hard cutoff.
   */
  it('kills an infinite while(true) loop within the 200ms budget', async () => {
    const t0 = Date.now()
    const result = await runner.run({
      script: 'while(true){}',
      request: dummyRequest,
    })
    const elapsed = Date.now() - t0
    expect(result.outcome).toBe(ScriptOutcome.TIMEOUT)
    // The parent timeout fires at 200ms; allow generous slack for
    // worker startup + cleanup on a busy CI box, but it must NOT
    // be anywhere near infinite.
    expect(elapsed).toBeLessThan(2000)
  }, 5000)

  it('kills a date-arithmetic infinite loop within the budget', async () => {
    const t0 = Date.now()
    const result = await runner.run({
      script: 'while (Date.now() < Date.now() + 500) {} return "should never make it"',
      request: dummyRequest,
    })
    const elapsed = Date.now() - t0
    expect(result.outcome).toBe(ScriptOutcome.TIMEOUT)
    expect(elapsed).toBeLessThan(2000)
  }, 5000)

  it('honors a per-call timeoutMs override (smaller than the default)', async () => {
    const t0 = Date.now()
    const result = await runner.run({
      script: 'while(true){}',
      request: dummyRequest,
      timeoutMs: 80,
    })
    const elapsed = Date.now() - t0
    expect(result.outcome).toBe(ScriptOutcome.TIMEOUT)
    expect(elapsed).toBeLessThan(1500)
  }, 5000)

  it('reports THREW for a script with a syntax error', async () => {
    const result = await runner.run({
      script: 'return (',
      request: dummyRequest,
    })
    expect(result.outcome).toBe(ScriptOutcome.THREW)
  })

  it('does NOT expose `globalThis` to the script', async () => {
    const result = await runner.run({
      script: 'return typeof globalThis',
      request: dummyRequest,
    })
    // The user can still reach the sandbox object via `this`, but
    // `globalThis` is `undefined` by design. The script returns
    // "undefined", which is non-string → INVALID. Either outcome
    // (THREW with "string" error, or "undefined" body that fails
    // downstream) is acceptable; the key invariant is that
    // `globalThis` itself is not the host global.
    if (result.outcome === ScriptOutcome.OK) {
      expect(result.body).toBe('undefined')
    } else {
      expect(result.error).toMatch(/string/)
    }
  })

  it('forwards the request context into the sandbox as a frozen object', async () => {
    const result = await runner.run({
      script: `try {
        request.method = 'PATCH'
        return 'mutated'
      } catch (e) {
        return 'frozen'
      }`,
      request: dummyRequest,
    })
    // In strict mode (which we use) mutating a frozen object
    // throws TypeError; the catch returns 'frozen'.
    expect(result.outcome).toBe(ScriptOutcome.OK)
    expect(result.body).toBe('frozen')
  })
})

describe('WorkerThreadRunner — isolation / concurrency', () => {
  it('runs many scripts sequentially without state bleed', async () => {
    const runner = new WorkerThreadRunner()
    const r1 = await runner.run({
      script: 'return "one:" + request.path',
      request: dummyRequest,
    })
    const r2 = await runner.run({
      script: 'return "two:" + request.path',
      request: dummyRequest,
    })
    const r3 = await runner.run({
      script: 'return "three:" + request.path',
      request: dummyRequest,
    })
    expect(r1.body).toBe('one:/i/test')
    expect(r2.body).toBe('two:/i/test')
    expect(r3.body).toBe('three:/i/test')
  })

  it('runs several scripts in parallel and each gets a fresh worker', async () => {
    const runner = new WorkerThreadRunner()
    const results = await Promise.all([
      runner.run({ script: 'return "a"', request: dummyRequest }),
      runner.run({ script: 'return "b"', request: dummyRequest }),
      runner.run({ script: 'return "c"', request: dummyRequest }),
      runner.run({ script: 'return "d"', request: dummyRequest }),
    ])
    expect(results.map((r) => r.body).sort()).toEqual(['a', 'b', 'c', 'd'])
  })
})