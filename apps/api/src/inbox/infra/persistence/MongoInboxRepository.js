import { InboxRepository } from '../../domain/InboxRepository.js'
import {
  MAX_CAPTURE_COUNT,
  RATE_LIMIT_WINDOW_MS,
  RATE_LIMIT_MAX_REQUESTS,
} from '../../domain/SandboxInbox.js'

/**
 * Mongo-backed InboxRepository.
 * The token is the document key (stored as `token`, unique-indexed).
 *
 * The `tryConsumeCaptureSlot` method is the only place that mutates
 * `captureCount` / `rateWindow`. It uses two `findOneAndUpdate` calls
 * with conditional filters — both atomic in Mongo — so concurrent
 * captures cannot slip past either the capacity or the rate cap.
 * The (rare) race where two requests hit the boundary at the same
 * millisecond is resolved by Mongo: only one update's filter matches.
 */
export class MongoInboxRepository extends InboxRepository {
  constructor(db) {
    super()
    this.col = db.collection('inboxes')
  }

  async findByToken(token) {
    return this.col.findOne({ token }, { projection: { _id: 0 } }) ?? null
  }

  async insert(inbox) {
    await this.col.insertOne(inbox.toDocument())
  }

  async updateResponseConfig(token, responseConfig, mockBodySize = 0) {
    await this.col.updateOne(
      { token },
      { $set: { responseConfig, mockBodySize } },
    )
  }

  async updateForwardTo(token, forwardTo) {
    await this.col.updateOne(
      { token },
      { $set: { forwardTo } },
    )
  }

  async updateCaptureFilter(token, captureFilter) {
    await this.col.updateOne(
      { token },
      { $set: { captureFilter } },
    )
  }

  async resetCaptureCount(token) {
    await this.col.updateOne(
      { token },
      { $set: { captureCount: 0, rateWindow: { startedAt: null, count: 0 } } },
    )
  }

  async tryConsumeCaptureSlot(token, now) {
    const doc = await this.findByToken(token)
    if (!doc) return { ok: false, inbox: null, reason: 'inbox_not_found' }

    if ((doc.captureCount ?? 0) >= MAX_CAPTURE_COUNT) {
      return { ok: false, inbox: doc, reason: 'capacity_exceeded' }
    }

    const startedAt = doc.rateWindow && doc.rateWindow.startedAt
      ? new Date(doc.rateWindow.startedAt)
      : null
    const count = doc.rateWindow && typeof doc.rateWindow.count === 'number'
      ? doc.rateWindow.count
      : 0

    if (startedAt && (now.getTime() - startedAt.getTime()) < RATE_LIMIT_WINDOW_MS && count >= RATE_LIMIT_MAX_REQUESTS) {
      const retryAfterMs = RATE_LIMIT_WINDOW_MS - (now.getTime() - startedAt.getTime())
      return { ok: false, inbox: doc, reason: 'rate_limited', retryAfterMs }
    }

    const windowExpired = !startedAt || (now.getTime() - startedAt.getTime()) >= RATE_LIMIT_WINDOW_MS

    if (windowExpired) {
      const updated = await this.col.findOneAndUpdate(
        {
          token,
          captureCount: { $lt: MAX_CAPTURE_COUNT },
          $or: [
            { rateWindow: { $exists: false } },
            { 'rateWindow.startedAt': null },
            { 'rateWindow.startedAt': { $lt: new Date(now.getTime() - RATE_LIMIT_WINDOW_MS) } },
          ],
        },
        {
          $inc: { captureCount: 1 },
          $set: {
            'rateWindow.startedAt': now,
            'rateWindow.count':     1,
          },
        },
        { returnDocument: 'after' },
      )
      if (updated) {
        return { ok: true, inbox: updated }
      }
      const fresh = await this.findByToken(token)
      if (!fresh) return { ok: false, inbox: null, reason: 'inbox_not_found' }
      if ((fresh.captureCount ?? 0) >= MAX_CAPTURE_COUNT) {
        return { ok: false, inbox: fresh, reason: 'capacity_exceeded' }
      }
      const freshStarted = fresh.rateWindow && fresh.rateWindow.startedAt
        ? new Date(fresh.rateWindow.startedAt)
        : null
      const freshCount = fresh.rateWindow && typeof fresh.rateWindow.count === 'number'
        ? fresh.rateWindow.count
        : 0
      const retryAfterMs = freshStarted && freshCount >= RATE_LIMIT_MAX_REQUESTS
        ? Math.max(1, RATE_LIMIT_WINDOW_MS - (now.getTime() - freshStarted.getTime()))
        : RATE_LIMIT_WINDOW_MS
      return { ok: false, inbox: fresh, reason: 'rate_limited', retryAfterMs }
    }

    const updated = await this.col.findOneAndUpdate(
      {
        token,
        captureCount:        { $lt: MAX_CAPTURE_COUNT },
        'rateWindow.count':  { $lt: RATE_LIMIT_MAX_REQUESTS },
      },
      { $inc: { captureCount: 1, 'rateWindow.count': 1 } },
      { returnDocument: 'after' },
    )
    if (updated) {
      return { ok: true, inbox: updated }
    }
    const fresh = await this.findByToken(token)
    if (!fresh) return { ok: false, inbox: null, reason: 'inbox_not_found' }
    if ((fresh.captureCount ?? 0) >= MAX_CAPTURE_COUNT) {
      return { ok: false, inbox: fresh, reason: 'capacity_exceeded' }
    }
    const freshStarted = fresh.rateWindow && fresh.rateWindow.startedAt
      ? new Date(fresh.rateWindow.startedAt)
      : null
    const retryAfterMs = freshStarted
      ? Math.max(1, RATE_LIMIT_WINDOW_MS - (now.getTime() - freshStarted.getTime()))
      : RATE_LIMIT_WINDOW_MS
    return { ok: false, inbox: fresh, reason: 'rate_limited', retryAfterMs }
  }
}
