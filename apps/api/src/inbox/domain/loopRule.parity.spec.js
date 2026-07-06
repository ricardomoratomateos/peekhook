import { describe, it, expect } from 'vitest'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { checkForwardLoop as apiCheck } from './loopRule.js'

// Import the mirrored web copy. We resolve via pathToFileURL so the
// dynamic import works on every platform (Windows, Linux, macOS).
//   spec lives at apps/api/src/inbox/domain/loopRule.parity.spec.js
//   web copy at apps/web/src/features/inspector/lib/loopRule.js
const specDir  = path.dirname(new URL(import.meta.url).pathname)
const apiRoot  = path.resolve(specDir, '..', '..', '..')          // apps/api
const webPath  = pathToFileURL(
  path.join(apiRoot, '..', 'web', 'src', 'features', 'inspector', 'lib', 'loopRule.js'),
).href
const { checkForwardLoop: webCheck } = await import(webPath)

const cases = [
  // [forwardTo, ingestOrigin, label]
  [null,                                            'https://peekhook.dev', 'null forwardTo'],
  [undefined,                                       'https://peekhook.dev', 'undefined forwardTo'],
  ['',                                              'https://peekhook.dev', 'empty forwardTo'],
  ['https://peekhook.dev/i/abc/token',              'https://peekhook.dev', 'same origin + /i/ path'],
  ['https://peekhook.dev/i/abc/token?x=1',          'https://peekhook.dev', 'same origin + /i/ + query'],
  ['https://peekhook.dev/api/anything',             'https://peekhook.dev', 'same origin + non-/i/ path'],
  ['https://peekhook.dev/healthz',                  'https://peekhook.dev', 'same origin + healthz'],
  ['https://peekhook.dev/',                         'https://peekhook.dev', 'same origin + root'],
  ['http://localhost:3000/webhook',                 'https://peekhook.dev', 'localhost dev'],
  ['http://127.0.0.1:3001/hook',                    'https://peekhook.dev', '127.0.0.1 dev'],
  ['https://example.com/i/some',                    'https://peekhook.dev', 'foreign origin even with /i/'],
  ['not a url',                                     'https://peekhook.dev', 'unparseable forward'],
  ['https://peekhook.dev/i/abc',                    'not a url',           'unparseable ingest'],
  ['http://peekhook.dev:3001/i/abc',                'http://peekhook.dev', 'same host, different port'],
  ['http://peekhook.dev/i/abc',                     'https://peekhook.dev', 'different scheme'],
  ['https://peekhook.dev/i/abc',                    null,                  'null ingestOrigin'],
  ['https://peekhook.dev/i/abc',                    '',                    'empty ingestOrigin'],
]

describe('loopRule parity (api vs web mirror)', () => {
  for (const [forwardTo, ingestOrigin, label] of cases) {
    it(`agrees on: ${label}`, () => {
      const a = apiCheck(forwardTo, ingestOrigin)
      const w = webCheck(forwardTo, ingestOrigin)
      expect(w).toEqual(a)
    })
  }

  it('both produce identical loop messages for the canonical case', () => {
    const a = apiCheck('https://peekhook.dev/i/abc', 'https://peekhook.dev')
    const w = webCheck('https://peekhook.dev/i/abc', 'https://peekhook.dev')
    expect(a.ok).toBe(false)
    expect(w.ok).toBe(false)
    expect(a.reason).toBe(w.reason)
    expect(a.message).toBe(w.message)
  })
})
