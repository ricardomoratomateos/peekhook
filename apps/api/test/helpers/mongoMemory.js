import { MongoMemoryServer } from 'mongodb-memory-server'
import { MongoClient } from 'mongodb'

let memServer
let client
let db

export async function startMongo() {
  memServer = await MongoMemoryServer.create()
  client = new MongoClient(memServer.getUri())
  await client.connect()
  db = client.db('peekhook-test')
  return db
}

export function getTestDb() {
  if (!db) throw new Error('startMongo() first')
  return db
}

export async function stopMongo() {
  if (client) await client.close()
  if (memServer) await memServer.stop()
}
