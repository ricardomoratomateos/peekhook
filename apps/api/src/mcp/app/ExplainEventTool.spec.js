import { describe, it, expect } from 'vitest'
import { ExplainEventTool, explain } from './ExplainEventTool.js'

const sut = new ExplainEventTool()

const stripeEvent = {
  method: 'POST',
  path: '/i/abc',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({
    id: 'evt_test_123',
    object: 'event',
    type: 'invoice.payment_succeeded',
    data: { object: { id: 'in_123', amount_paid: 1000 } },
  }),
}

const githubEvent = {
  method: 'POST',
  path: '/i/abc',
  headers: {
    'x-github-event': 'push',
    'x-github-delivery': 'd-uuid',
    'content-type': 'application/json',
  },
  body: JSON.stringify({ ref: 'refs/heads/main', repository: { full_name: 'org/repo' } }),
}

const linearEvent = {
  method: 'POST',
  path: '/i/abc',
  headers: {
    'user-agent': 'Linear-Webhook/1.0',
    'content-type': 'application/json',
  },
  body: JSON.stringify({ action: 'create', type: 'Issue', data: { id: 'iss_1' } }),
}

const unknownEvent = {
  method: 'POST',
  path: '/i/abc',
  headers: { 'content-type': 'text/plain' },
  body: 'just some bytes',
}

describe('ExplainEventTool', () => {
  it('recognises a Stripe-shaped body', async () => {
    const result = await sut.execute({ event: stripeEvent })
    expect(result.provider).toBe('stripe')
    expect(result.summary).toContain('Stripe')
    expect(result.summary).toContain('event')
    expect(result.field_count).toBe(result.fields.length)
    expect(result.fields.some((f) => f.path === 'id')).toBe(true)
    expect(result.fields.some((f) => f.path === 'data.object')).toBe(true)
  })

  it('recognises a GitHub event via x-github-event header', async () => {
    const result = await sut.execute({ event: githubEvent })
    expect(result.provider).toBe('github')
    expect(result.summary).toContain('push')
  })

  it('recognises a Linear webhook via user-agent', async () => {
    const result = await sut.execute({ event: linearEvent })
    expect(result.provider).toBe('linear')
    expect(result.summary).toContain('Linear')
  })

  it('falls back to unknown for an unrecognised shape', async () => {
    const result = await sut.execute({ event: unknownEvent })
    expect(result.provider).toBe('unknown')
    expect(result.summary).toContain('POST')
  })

  it('throws when no event is supplied', async () => {
    await expect(() => sut.execute({})).rejects.toThrow(/event document/)
  })

  it('pure-export `explain` matches the class method', async () => {
    expect(explain(stripeEvent).provider).toBe('stripe')
    expect(explain(githubEvent).provider).toBe('github')
    expect(explain(linearEvent).provider).toBe('linear')
    expect(explain(unknownEvent).provider).toBe('unknown')
  })
})
