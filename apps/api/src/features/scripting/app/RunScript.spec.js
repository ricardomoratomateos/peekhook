import { describe, it, expect } from 'vitest'
import { ScriptOutcome, SCRIPT_MAX_BYTES } from '../domain/ScriptErrors.js'
import { RunScript } from './RunScript.js'

function fakeRunner(respond) {
  return {
    async run({ script, request, timeoutMs }) {
      return await respond({ script, request, timeoutMs })
    },
  }
}

const dummyRequest = {
  method:      'POST',
  path:        '/i/abc',
  headers:     { 'content-type': 'application/json' },
  body:        '{"x":1}',
  contentType: 'application/json',
  query:       {},
}

describe('RunScript', () => {
  it('returns the runner-produced body on OK outcome', async () => {
    const runner = fakeRunner(({ script }) => ({
      outcome: ScriptOutcome.OK,
      body:    `ran:${script.length}`,
    }))
    const sut = new RunScript({ runner })

    const result = await sut.execute({
      script: 'return "hi"',
      request: dummyRequest,
    })

    expect(result.outcome).toBe('ok')
    expect(result.body).toBe('ran:11')
  })

  it('rejects scripts longer than 8 KB with INVALID', async () => {
    let called = false
    const runner = fakeRunner(() => { called = true; return { outcome: ScriptOutcome.OK, body: 'x' } })
    const sut = new RunScript({ runner })

    const oversized = 'a'.repeat(SCRIPT_MAX_BYTES + 1)
    const result = await sut.execute({ script: oversized, request: dummyRequest })

    expect(result.outcome).toBe('invalid')
    expect(result.error).toMatch(/8 KB/)
    expect(called).toBe(false)
  })

  it('rejects non-string scripts with INVALID', async () => {
    let called = false
    const runner = fakeRunner(() => { called = true; return { outcome: ScriptOutcome.OK, body: 'x' } })
    const sut = new RunScript({ runner })

    const result = await sut.execute({ script: { not: 'a string' }, request: dummyRequest })

    expect(result.outcome).toBe('invalid')
    expect(result.error).toMatch(/string/)
    expect(called).toBe(false)
  })

  it('propagates a THREW outcome with the runner error message', async () => {
    const runner = fakeRunner(() => ({ outcome: ScriptOutcome.THREW, error: 'ReferenceError: x is not defined' }))
    const sut = new RunScript({ runner })

    const result = await sut.execute({ script: 'throw new Error("boom")', request: dummyRequest })

    expect(result.outcome).toBe('threw')
    expect(result.error).toMatch(/ReferenceError/)
  })

  it('propagates a TIMEOUT outcome without a body', async () => {
    const runner = fakeRunner(() => ({ outcome: ScriptOutcome.TIMEOUT }))
    const sut = new RunScript({ runner })

    const result = await sut.execute({ script: 'while(true){}', request: dummyRequest, timeoutMs: 50 })

    expect(result.outcome).toBe('timeout')
    expect(result.body).toBeUndefined()
  })

  it('forwards timeoutMs through to the runner', async () => {
    let received = null
    const runner = fakeRunner(({ timeoutMs }) => { received = timeoutMs; return { outcome: ScriptOutcome.OK, body: 'x' } })
    const sut = new RunScript({ runner })

    await sut.execute({ script: 'return "x"', request: dummyRequest, timeoutMs: 47 })

    expect(received).toBe(47)
  })

  it('treats an OK outcome with a non-string body as INVALID', async () => {
    const runner = fakeRunner(() => ({ outcome: ScriptOutcome.OK, body: 12345 }))
    const sut = new RunScript({ runner })

    const result = await sut.execute({ script: 'return 12345', request: dummyRequest })

    expect(result.outcome).toBe('invalid')
    expect(result.error).toMatch(/string/)
  })
})
