#!/usr/bin/env node
import { MongoClient } from 'mongodb'
import { config } from '../../config.js'
import { MongoMcpAuthRepository } from './infra/MongoMcpAuthRepository.js'
import { MongoRequestListReadModel } from '../../infra/persistence/MongoRequestListReadModel.js'
import { MongoRequestSearchReadModel } from './infra/MongoRequestSearchReadModel.js'
import { VerifyMcpToken } from './app/VerifyMcpToken.js'
import { provideTools } from './infra/provideTools.js'
import { stdioTransport } from './infra/stdioTransport.js'

/**
 * cli.js — stdio MCP entry point.
 *
 * Connects to Mongo, wires the tool surface, and serves JSON-RPC 2.0
 * over stdin/stdout. Reads startup credentials from env
 * (`PEEKHOOK_MCP_INBOX`, `PEEKHOOK_MCP_TOKEN`) or CLI args
 * (`--inbox=X`, `--mcp=Y`). A startup credential check is advisory —
 * every `tools/call` re-authenticates with its own
 * `inbox_token`/`mcp_token` arguments.
 *
 * The orchestrator wires this into `src/index.js` after merge.
 */

function parseArgs(argv) {
  let inbox = process.env.PEEKHOOK_MCP_INBOX ?? null
  let mcp   = process.env.PEEKHOOK_MCP_TOKEN ?? null
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--inbox' && argv[i + 1])        inbox = argv[++i]
    else if (a.startsWith('--inbox='))         inbox = a.slice('--inbox='.length)
    else if (a === '--mcp' && argv[i + 1])     mcp = argv[++i]
    else if (a.startsWith('--mcp='))           mcp = a.slice('--mcp='.length)
  }
  return { inbox, mcp }
}

async function main() {
  const { inbox, mcp } = parseArgs(process.argv)

  const client = new MongoClient(config.mongoUri)
  await client.connect()
  const db = client.db()

  const mcpAuth    = new MongoMcpAuthRepository(db)
  const readModel  = new MongoRequestListReadModel(db)
  const searchModel = new MongoRequestSearchReadModel(db)
  const surface    = provideTools({ mcpAuth, readModel, searchModel })

  if (inbox && mcp) {
    const verify  = new VerifyMcpToken({ mcpAuth })
    const result  = await verify.execute({ inboxToken: inbox, mcpToken: mcp })
    if (!result.ok) {
      console.error(`startup auth check failed: ${result.reason}`)
      await client.close()
      process.exit(2)
    }
  }

  stdioTransport({
    listTools: surface.listTools,
    callTool:  surface.callTool,
  })
}

main().catch((err) => {
  console.error(err && err.stack ? err.stack : err)
  process.exit(1)
})
