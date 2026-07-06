import { describe, it, expect } from 'vitest'
import { GetSchemaHistory } from './GetSchemaHistory.js'
import { PayloadSchema } from '../domain/PayloadSchema.js'
import { FieldObservation } from '../domain/FieldObservation.js'

function buildRepo(initial) {
  return {
    async findByToken(token) {
      if (!initial || initial.inboxToken !== token) return null
      return new PayloadSchema({
        inboxToken: initial.inboxToken,
        fields:     initial.fields,
        expiresAt:  initial.expiresAt ?? null,
      })
    },
  }
}

function obs(path, type, firstSeenAt, lastSeenAt, occurrences) {
  return FieldObservation.create({ path, type, firstSeenAt, lastSeenAt, occurrences })
}

describe('GetSchemaHistory', () => {
  it('returns an empty DTO when the inbox has no schema yet', async () => {
    const repo = buildRepo(null)
    const sut  = new GetSchemaHistory({ schemas: repo })
    const dto  = await sut.execute({ inboxToken: 'tok' })

    expect(dto).toEqual({ inboxToken: 'tok', fields: [] })
  })

  it('returns the stored schema sorted by firstSeenAt ascending', async () => {
    const t0 = new Date(Date.UTC(2026, 0, 1, 0, 0, 0))
    const t1 = new Date(Date.UTC(2026, 0, 1, 0, 0, 5))
    const t2 = new Date(Date.UTC(2026, 0, 1, 0, 0, 9))
    const repo = buildRepo({
      inboxToken: 'tok',
      fields: [
        obs('c', 'boolean', t2, t2, 1),
        obs('a', 'number',  t0, t0, 1),
        obs('b', 'number',  t1, t1, 1),
      ],
    })
    const sut = new GetSchemaHistory({ schemas: repo })
    const dto = await sut.execute({ inboxToken: 'tok' })

    expect(dto.inboxToken).toBe('tok')
    expect(dto.fields.map((f) => f.path)).toEqual(['a', 'b', 'c'])
    expect(dto.fields.map((f) => f.firstSeenAt.getTime())).toEqual([t0.getTime(), t1.getTime(), t2.getTime()])
    expect(dto.fields).toEqual([
      { path: 'a', type: 'number',  firstSeenAt: t0, lastSeenAt: t0, occurrences: 1 },
      { path: 'b', type: 'number',  firstSeenAt: t1, lastSeenAt: t1, occurrences: 1 },
      { path: 'c', type: 'boolean', firstSeenAt: t2, lastSeenAt: t2, occurrences: 1 },
    ])
  })

  it('preserves insertion order for two observation slots that share a firstSeenAt', async () => {
    const t = new Date(Date.UTC(2026, 0, 1, 0, 0, 0))
    const repo = buildRepo({
      inboxToken: 'tok',
      fields: [
        obs('a', 'number', t, t, 2),
        obs('b', 'string', t, t, 1),
      ],
    })
    const sut = new GetSchemaHistory({ schemas: repo })
    const dto = await sut.execute({ inboxToken: 'tok' })
    expect(dto.fields.map((f) => [f.path, f.type])).toEqual([
      ['a', 'number'],
      ['b', 'string'],
    ])
  })
})
