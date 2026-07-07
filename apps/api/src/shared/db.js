import { MongoClient } from 'mongodb'
import { config } from '../config.js'

let client
let db

export async function connectDb() {
  client = new MongoClient(config.mongoUri)
  await client.connect()
  db = client.db()

  await db.collection('inboxes').createIndex({ token: 1 }, { unique: true })
  await db.collection('inboxes').createIndex(
    { expiresAt: 1 },
    { expireAfterSeconds: 0 }
  )

  await db.collection('requests').createIndex({ inboxToken: 1, createdAt: -1 })
  await db.collection('requests').createIndex(
    { expiresAt: 1 },
    { expireAfterSeconds: 0 }
  )
  // Most captures are never shared — shareId is unset (or null) at
  // capture time and only filled in by the explicit share endpoint.
  // A sparse index doesn't help here because the field is present on
  // every doc (set to null on insert) and `null` is treated as a value,
  // not "absent", so a (inboxToken, shareId) UNIQUE sparse index still
  // collides when the same inbox has two unshared captures. The correct
  // primitive is a partial unique index keyed only on docs that actually
  // have a shareId string.
  try {
    await db.collection('requests').dropIndex('inboxToken_1_shareId_1')
  } catch (_) {
    // Index doesn't exist (first boot, or already migrated) — fine.
  }
  await db.collection('requests').createIndex(
    { inboxToken: 1, shareId: 1 },
    {
      name: 'inboxToken_1_shareId_1_shared',
      unique: true,
      partialFilterExpression: { shareId: { $type: 'string' } },
    }
  )

  await db.collection('payload_schemas').createIndex(
    { inboxToken: 1 },
    { unique: true }
  )
  await db.collection('payload_schemas').createIndex(
    { expiresAt: 1 },
    { expireAfterSeconds: 0 }
  )

  // mcp_audit_log — 7-day TTL to match the rest of the ephemeral
  // data layer. A single-field TTL index on `timestamp` is required
  // (MongoDB does not support TTL on compound indexes). The
  // compound `(tokenHash, timestamp)` index is created lazily by
  // MongoMcpAuditLog on first write to keep this file agnostic of
  // the MCP module.
  await db.collection('mcp_audit_log').createIndex(
    { timestamp: 1 },
    { expireAfterSeconds: 7 * 24 * 60 * 60 }
  )

  console.log(`MongoDB connected: ${config.mongoUri}`)
  return db
}

export function getDb() {
  if (!db) throw new Error('DB not initialized. Call connectDb() first.')
  return db
}

// Test-only setters. Prefix `__` signals internal. Tests point the
// module at an in-memory Mongo (mongodb-memory-server) so use cases can
// be wired without spinning up the real connection flow.
export function __setDbForTest(testDb) {
  db = testDb
}

export function __resetDbForTest() {
  db = undefined
  client = undefined
}

export async function closeDb() {
  if (client) await client.close()
}
