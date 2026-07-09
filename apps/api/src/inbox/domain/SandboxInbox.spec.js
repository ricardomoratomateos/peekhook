import { describe, it, expect } from 'vitest'
import {
  SandboxInbox,
  validateResponseConfig,
  MAX_CAPTURE_COUNT,
  MOCK_BODY_MAX_BYTES,
  RATE_LIMIT_MAX_REQUESTS,
  RATE_LIMIT_WINDOW_MS,
  ALLOWED_MOCK_CONTENT_TYPES,
} from './SandboxInbox.js'

/**
 * Aggregate-level tests for the new fields backing the v1.1 security
 * limits (reception + sending, items 2 + 7: "Rate limit per token" and
 * "Per-inbox request cap: 1,000"). The aggregate is pure — these tests
 * run with no Mongo / no Fastify.
 */
describe('SandboxInbox — security aggregate fields', () => {
  it('initializes captureCount to 0 and rateWindow to { startedAt: null, count: 0 } when minted', () => {
    const inbox = SandboxInbox.create()
    expect(inbox.captureCount).toBe(0)
    expect(inbox.rateWindow).toEqual({ startedAt: null, count: 0 })
  })

  it('persists the new fields via toDocument()', () => {
    const inbox = SandboxInbox.create()
    const doc = inbox.toDocument()
    expect(doc.captureCount).toBe(0)
    expect(doc.rateWindow).toEqual({ startedAt: null, count: 0 })
  })

  it('exposes the constants the capture use case enforces', () => {
    expect(MAX_CAPTURE_COUNT).toBe(1000)
    expect(RATE_LIMIT_MAX_REQUESTS).toBe(60)
    expect(RATE_LIMIT_WINDOW_MS).toBe(60_000)
  })

  it('initializes mockBodySize to 0 when minted (no mock reply yet)', () => {
    const inbox = SandboxInbox.create()
    expect(inbox.mockBodySize).toBe(0)
    expect(inbox.toDocument().mockBodySize).toBe(0)
  })

  it('rehydrates mockBodySize from a stored document', () => {
    const stored = SandboxInbox.create()
    const next = new SandboxInbox({
      token:          stored.token,
      createdAt:      stored.createdAt,
      expiresAt:      stored.expiresAt,
      mockBodySize:   12_345,
    })
    expect(next.mockBodySize).toBe(12_345)
  })

  it('rehydrates from a stored document without losing counter state', () => {
    const stored = SandboxInbox.create()
    const next = new SandboxInbox({
      token:          stored.token,
      createdAt:      stored.createdAt,
      expiresAt:      stored.expiresAt,
      captureCount:   7,
      rateWindow:     { startedAt: new Date('2026-01-01T00:00:00Z'), count: 42 },
    })
    expect(next.captureCount).toBe(7)
    expect(next.rateWindow.startedAt.toISOString()).toBe('2026-01-01T00:00:00.000Z')
    expect(next.rateWindow.count).toBe(42)
  })

  it('rehydrates from a stored document whose rateWindow.startedAt is a string', () => {
    const stored = SandboxInbox.create()
    const next = new SandboxInbox({
      token:          stored.token,
      createdAt:      stored.createdAt,
      expiresAt:      stored.expiresAt,
      captureCount:   3,
      rateWindow:     { startedAt: '2026-02-02T12:00:00Z', count: 13 },
    })
    expect(next.rateWindow.startedAt).toBeInstanceOf(Date)
    expect(next.rateWindow.startedAt.toISOString()).toBe('2026-02-02T12:00:00.000Z')
    expect(next.rateWindow.count).toBe(13)
  })
})

describe('validateResponseConfig — security limits', () => {
  const baseValid = {
    enabled:     true,
    status:      200,
    contentType: 'application/json',
    body:        '{"ok":true}',
  }

  it('accepts a baseline valid config', () => {
    const cleaned = validateResponseConfig(baseValid)
    // delayMs defaults to 0 (latency-simulation feature).
    expect(cleaned).toEqual({ ...baseValid, delayMs: 0 })
  })

  it('accepts an in-range delayMs and defaults it to 0', () => {
    expect(validateResponseConfig(baseValid).delayMs).toBe(0)
    expect(validateResponseConfig({ ...baseValid, delayMs: 2500 }).delayMs).toBe(2500)
    expect(validateResponseConfig({ ...baseValid, delayMs: 30000 }).delayMs).toBe(30000)
  })

  it('rejects a delayMs that is negative, over the cap, or non-integer', () => {
    expect(() => validateResponseConfig({ ...baseValid, delayMs: -1 })).toThrow(/delayMs/)
    expect(() => validateResponseConfig({ ...baseValid, delayMs: 30001 })).toThrow(/delayMs/)
    expect(() => validateResponseConfig({ ...baseValid, delayMs: 1.5 })).toThrow(/delayMs/)
    expect(() => validateResponseConfig({ ...baseValid, delayMs: '100' })).toThrow(/delayMs/)
  })

  it('accepts null (clear)', () => {
    expect(validateResponseConfig(null)).toBeNull()
    expect(validateResponseConfig(undefined)).toBeNull()
  })

  it('rejects CR in content-type (header-injection defense)', () => {
    expect(() => validateResponseConfig({ ...baseValid, contentType: 'text/plain\rSet-Cookie: x=y' }))
      .toThrow(/CR or LF/)
  })

  it('rejects LF in content-type (header-injection defense)', () => {
    expect(() => validateResponseConfig({ ...baseValid, contentType: 'text/plain\nSet-Cookie: x=y' }))
      .toThrow(/CR or LF/)
  })

  it('rejects CRLF in content-type (the classic \r\n smuggling attempt)', () => {
    expect(() => validateResponseConfig({ ...baseValid, contentType: 'text/html\r\nSet-Cookie: x=y' }))
      .toThrow(/CR or LF/)
  })

  it('rejects application/javascript content-type (XSS smuggling via public /i/:token)', () => {
    expect(() => validateResponseConfig({ ...baseValid, contentType: 'application/javascript' }))
      .toThrow(/text\/plain, application\/json, application\/xml, text\/html/)
  })

  it('rejects text/css content-type', () => {
    expect(() => validateResponseConfig({ ...baseValid, contentType: 'text/css' }))
      .toThrow(/must be one of/)
  })

  it('rejects application/octet-stream content-type (binary body smuggling)', () => {
    expect(() => validateResponseConfig({ ...baseValid, contentType: 'application/octet-stream' }))
      .toThrow(/must be one of/)
  })

  it('accepts all four allowlisted content-types', () => {
    for (const ct of ALLOWED_MOCK_CONTENT_TYPES) {
      expect(() => validateResponseConfig({ ...baseValid, contentType: ct })).not.toThrow()
    }
  })

  it('accepts a content-type with a charset parameter (still in the allowlist family)', () => {
    // application/json; charset=utf-8 is NOT in the strict allowlist,
    // but the validator only checks the bare value. Document the
    // behavior here so a future change is deliberate.
    expect(() => validateResponseConfig({ ...baseValid, contentType: 'application/json; charset=utf-8' }))
      .toThrow(/must be one of/)
  })

  it('accepts a body whose byte length is exactly MOCK_BODY_MAX_BYTES', () => {
    const body = 'a'.repeat(MOCK_BODY_MAX_BYTES)
    const cleaned = validateResponseConfig({ ...baseValid, body })
    expect(Buffer.byteLength(cleaned.body, 'utf8')).toBe(MOCK_BODY_MAX_BYTES)
  })

  it('rejects a body whose byte length is MOCK_BODY_MAX_BYTES + 1', () => {
    const body = 'a'.repeat(MOCK_BODY_MAX_BYTES + 1)
    expect(() => validateResponseConfig({ ...baseValid, body })).toThrow(/exceeds 65536 byte limit/)
  })

  it('rejects a 65 KB body (the ROADMAP-specific upper-bound scenario)', () => {
    const body = 'a'.repeat(65 * 1024)
    expect(() => validateResponseConfig({ ...baseValid, body })).toThrow(/exceeds 65536 byte limit/)
  })

  it('accepts a 64 KB body (the ROADMAP-specific boundary)', () => {
    const body = 'a'.repeat(64 * 1024)
    expect(() => validateResponseConfig({ ...baseValid, body })).not.toThrow()
  })

  it('accepts an empty body (default mock-reply case)', () => {
    expect(() => validateResponseConfig({ ...baseValid, body: '' })).not.toThrow()
  })

  it('measures multi-byte UTF-8 correctly (em-dash counts more than 1 byte each)', () => {
    // Each '—' is 3 bytes in UTF-8 (E2 80 94). 30 em-dashes = 90 bytes.
    const body = '—'.repeat(30)
    expect(Buffer.byteLength(body, 'utf8')).toBe(90)
    expect(() => validateResponseConfig({ ...baseValid, body })).not.toThrow()
  })

  it('rejects a multi-byte UTF-8 body that exceeds 64 KB', () => {
    // Each '—' is 3 bytes; 22_000 em-dashes = 66_000 bytes (> 64 KB).
    const body = '—'.repeat(22_000)
    expect(Buffer.byteLength(body, 'utf8')).toBeGreaterThan(MOCK_BODY_MAX_BYTES)
    expect(() => validateResponseConfig({ ...baseValid, body })).toThrow(/exceeds 65536 byte limit/)
  })
})
