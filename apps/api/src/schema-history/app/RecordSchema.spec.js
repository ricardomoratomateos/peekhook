import { describe, it, expect } from 'vitest'
import { RecordSchema } from './RecordSchema.js'
import { PayloadSchema } from '../domain/PayloadSchema.js'
import { FieldObservation } from '../domain/FieldObservation.js'

function buildRepo(initialObservations) {
  let current = initialObservations && initialObservations.length
    ? new PayloadSchema({
        inboxToken: 'tok',
        fields:     initialObservations,
        expiresAt:  new Date(Date.UTC(2026, 0, 1, 0, 0, 0)),
      })
    : null
  return {
    writes: [],
    async findByToken(_token) {
      if (!current) return null
      return new PayloadSchema({
        inboxToken: current.inboxToken,
        fields:     current.fields,
        expiresAt:  current.expiresAt,
      })
    },
    async upsert(schema) {
      this.writes.push(schema)
      current = new PayloadSchema({
        inboxToken: schema.inboxToken,
        fields:     schema.fields.slice(),
        expiresAt:  schema.expiresAt,
      })
    },
  }
}

function fixedNow() {
  let i = 0
  return () => new Date(Date.UTC(2026, 0, 1, 0, 0, i++))
}

describe('RecordSchema', () => {
  it('creates an observation with firstSeenAt=lastSeenAt=now and occurrences=1 on first capture', async () => {
    const repo   = buildRepo(null)
    const now    = new Date(Date.UTC(2026, 0, 1, 0, 0, 0))
    const sut    = new RecordSchema({ schemas: repo, now: () => now })
    await sut.execute({ inboxToken: 'tok', body: '{"a":1,"b":"x"}' })

    expect(repo.writes).toHaveLength(1)
    const written = repo.writes[0]
    expect(written.inboxToken).toBe('tok')
    expect(written.fields.map((f) => f.toDto())).toEqual([
      { path: 'a', type: 'number', firstSeenAt: now, lastSeenAt: now, occurrences: 1 },
      { path: 'b', type: 'string', firstSeenAt: now, lastSeenAt: now, occurrences: 1 },
    ])
    expect(written.expiresAt).toBeInstanceOf(Date)
  })

  it('increments occurrences and updates lastSeenAt for an existing (path, type), without duplicating', async () => {
    const t0 = new Date(Date.UTC(2026, 0, 1, 0, 0, 0))
    const t1 = new Date(Date.UTC(2026, 0, 1, 0, 0, 5))
    let now = t0
    const repo = buildRepo([
      FieldObservation.create({ path: 'a', type: 'number', firstSeenAt: t0, lastSeenAt: t0, occurrences: 3 }),
    ])
    const sut = new RecordSchema({ schemas: repo, now: () => now })

    now = t1
    await sut.execute({ inboxToken: 'tok', body: '{"a":42}' })

    const written = repo.writes.at(-1)
    expect(written.fields).toHaveLength(1)
    expect(written.fields[0].toDto()).toEqual({
      path: 'a', type: 'number',
      firstSeenAt: t0, lastSeenAt: t1, occurrences: 4,
    })
  })

  it('adds a new entry when the same path is observed with a different type', async () => {
    const t0 = new Date(Date.UTC(2026, 0, 1, 0, 0, 0))
    const t1 = new Date(Date.UTC(2026, 0, 1, 0, 0, 5))
    const repo = buildRepo([
      FieldObservation.create({ path: 'a', type: 'number', firstSeenAt: t0, lastSeenAt: t0, occurrences: 1 }),
    ])
    const sut = new RecordSchema({ schemas: repo, now: () => t1 })

    await sut.execute({ inboxToken: 'tok', body: '{"a":"now a string"}' })

    const written = repo.writes.at(-1)
    expect(written.fields).toHaveLength(2)
    expect(written.fields[0].toDto()).toEqual({
      path: 'a', type: 'number',
      firstSeenAt: t0, lastSeenAt: t0, occurrences: 1,
    })
    expect(written.fields[1].toDto()).toEqual({
      path: 'a', type: 'string',
      firstSeenAt: t1, lastSeenAt: t1, occurrences: 1,
    })
  })

  it('merges entries from a multi-field body in one observation', async () => {
    const t0 = new Date(Date.UTC(2026, 0, 1, 0, 0, 0))
    const repo = buildRepo(null)
    const sut  = new RecordSchema({ schemas: repo, now: () => t0 })

    await sut.execute({ inboxToken: 'tok', body: '{"a":1,"b":"x","c":[1,2,3]}' })

    const written = repo.writes.at(-1)
    expect(written.fields.map((f) => f.toDto())).toEqual([
      { path: 'a', type: 'number', firstSeenAt: t0, lastSeenAt: t0, occurrences: 1 },
      { path: 'b', type: 'string', firstSeenAt: t0, lastSeenAt: t0, occurrences: 1 },
      { path: 'c', type: 'array',  firstSeenAt: t0, lastSeenAt: t0, occurrences: 1 },
    ])
  })

  it('silently skips malformed JSON, leaving the schema unchanged', async () => {
    const t0 = new Date(Date.UTC(2026, 0, 1, 0, 0, 0))
    const repo = buildRepo(null)
    const sut  = new RecordSchema({ schemas: repo, now: () => t0 })

    await sut.execute({ inboxToken: 'tok', body: 'not json' })
    expect(repo.writes).toHaveLength(0)
  })

  it('skips an empty body without writing', async () => {
    const repo = buildRepo(null)
    const sut  = new RecordSchema({ schemas: repo, now: fixedNow() })

    await sut.execute({ inboxToken: 'tok', body: '' })
    expect(repo.writes).toHaveLength(0)
  })

  it('keeps chronological order on subsequent observes with mixed timestamps', async () => {
    const t0 = new Date(Date.UTC(2026, 0, 1, 0, 0, 0))
    const t1 = new Date(Date.UTC(2026, 0, 1, 0, 0, 5))
    const t2 = new Date(Date.UTC(2026, 0, 1, 0, 0, 9))
    const repo = buildRepo(null)
    let nowAt = t0
    const sut  = new RecordSchema({ schemas: repo, now: () => nowAt })

    nowAt = t0
    await sut.execute({ inboxToken: 'tok', body: '{"a":1}' })           // a:number @ t0
    nowAt = t1
    await sut.execute({ inboxToken: 'tok', body: '{"a":"x","b":2}' }) // a:string @ t1, b:number @ t1 — both t1
    nowAt = t2
    await sut.execute({ inboxToken: 'tok', body: '{"a":"x","c":true}' }) // a:string++ + c:boolean @ t2

    const written = repo.writes.at(-1)
    const lastSeenA = written.fields.find((f) => f.path === 'a' && f.type === 'string')
    expect(lastSeenA.lastSeenAt.getTime()).toBe(t2.getTime())

    const ordered = written.fields.map((f) => [f.path, f.type, f.occurrences, f.firstSeenAt.getTime()])
    expect(ordered).toEqual([
      ['a', 'number',  1, t0.getTime()],
      ['a', 'string',  2, t1.getTime()],
      ['b', 'number',  1, t1.getTime()],
      ['c', 'boolean', 1, t2.getTime()],
    ])
  })
})
