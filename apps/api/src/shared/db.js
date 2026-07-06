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

  await db.collection('payload_schemas').createIndex(
    { inboxToken: 1 },
    { unique: true }
  )
  await db.collection('payload_schemas').createIndex(
    { expiresAt: 1 },
    { expireAfterSeconds: 0 }
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
