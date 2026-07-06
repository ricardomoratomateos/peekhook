import { Tool } from '../domain/Tool.js'
import { VerifyMcpToken } from '../app/VerifyMcpToken.js'
import { ListEventTool } from '../app/ListEventTool.js'
import { GetEventTool } from '../app/GetEventTool.js'
import { SearchEventsTool } from '../app/SearchEventsTool.js'
import { DiffEventsTool } from '../app/DiffEventsTool.js'
import { ExplainEventTool } from '../app/ExplainEventTool.js'

/**
 * provideTools — wires the MCP tool surface from raw ports.
 *
 * Takes:
 *   - mcpAuth      : port for inbox lookup + mcpTokenHash read/write
 *   - readModel    : existing `RequestListReadModel` (list + findById)
 *   - searchModel  : `RequestSearchReadModel` (path/header/body regex)
 *
 * Returns:
 *   - tools     : `Tool[]` to advertise on `tools/list`
 *   - listTools : plain projection for transport advertisement
 *   - callTool  : dispatcher `(name, args) => Promise<result>`
 *
 * Every `tools/call` is authenticated via `assertAuth` before the
 * tool handler runs — the auth check uses `inbox_token` and
 * `mcp_token` from arguments.
 */
export function provideTools({ mcpAuth, readModel, searchModel }) {
  const verify   = new VerifyMcpToken({ mcpAuth })
  const listEv   = new ListEventTool({ readModel })
  const getEv    = new GetEventTool({ readModel })
  const searchEv = new SearchEventsTool({ readModel: searchModel })
  const diffEv   = new DiffEventsTool({ readModel })
  const explainEv = new ExplainEventTool()

  const tools = [
    new Tool({
      name: 'list_events',
      description: 'List the most recent captured webhook events for an inbox. Cursor-paginated; limit defaults to 50, max 200.',
      inputSchema: {
        type: 'object',
        required: ['inbox_token', 'mcp_token'],
        properties: {
          inbox_token: { type: 'string', description: 'Inbox token returned by POST /api/inboxes' },
          mcp_token:   { type: 'string', description: 'Plaintext MCP token returned alongside inbox token' },
          limit:       { type: 'integer', minimum: 1, maximum: 200, default: 50 },
          before:      { type: 'string', description: 'Cursor (ObjectId) — return events strictly older than this id' },
        },
      },
      handler: async (args) => {
        await assertAuth(verify, args)
        return listEv.execute(args)
      },
    }),
    new Tool({
      name: 'get_event',
      description: 'Fetch a single captured event by id. Body is decoded as JSON when content-type is JSON.',
      inputSchema: {
        type: 'object',
        required: ['inbox_token', 'mcp_token', 'event_id'],
        properties: {
          inbox_token: { type: 'string' },
          mcp_token:   { type: 'string' },
          event_id:    { type: 'string', description: 'Captured request id (ObjectId hex)' },
        },
      },
      handler: async (args) => {
        await assertAuth(verify, args)
        return getEv.execute(args)
      },
    }),
    new Tool({
      name: 'search_events',
      description: 'Apply a regex to request path, body, or a specific header. Limit 50 results.',
      inputSchema: {
        type: 'object',
        required: ['inbox_token', 'mcp_token', 'regex'],
        properties: {
          inbox_token: { type: 'string' },
          mcp_token:   { type: 'string' },
          regex:       { type: 'string', description: 'Substring pattern (case-insensitive; metacharacters escaped)' },
          field:       { type: 'string', enum: ['path', 'header', 'body'], default: 'path' },
          header_key:  { type: 'string', description: 'Required when field="header"' },
        },
      },
      handler: async (args) => {
        await assertAuth(verify, args)
        return searchEv.execute(args)
      },
    }),
    new Tool({
      name: 'diff_events',
      description: 'Compare two captured events by id: lists header differences and a line-level body diff.',
      inputSchema: {
        type: 'object',
        required: ['inbox_token', 'mcp_token', 'event_a_id', 'event_b_id'],
        properties: {
          inbox_token:  { type: 'string' },
          mcp_token:    { type: 'string' },
          event_a_id:   { type: 'string' },
          event_b_id:   { type: 'string' },
        },
      },
      handler: async (args) => {
        await assertAuth(verify, args)
        return diffEv.execute(args)
      },
    }),
    new Tool({
      name: 'explain_event',
      description: 'Detect the webhook provider (Stripe / GitHub / Linear / unknown) and return a one-line summary plus the body schema shape.',
      inputSchema: {
        type: 'object',
        required: ['inbox_token', 'mcp_token', 'event_id'],
        properties: {
          inbox_token: { type: 'string' },
          mcp_token:   { type: 'string' },
          event_id:    { type: 'string' },
        },
      },
      handler: async (args) => {
        await assertAuth(verify, args)
        const dto = await getEv.execute(args)
        if (!dto) throw new Error(`event (${args.event_id}) not found`)
        return explainEv.execute({ event: dto })
      },
    }),
  ]

  const byName = new Map(tools.map((t) => [t.name, t]))

  return {
    tools,
    listTools: () => tools.map((t) => ({
      name: t.name,
      description: t.description,
      inputSchema: t.inputSchema,
    })),
    callTool: async (name, args) => {
      const tool = byName.get(name)
      if (!tool) throw new Error(`unknown tool: ${name}`)
      return tool.handler(args)
    },
  }
}

async function assertAuth(verify, args) {
  const result = await verify.execute({
    inboxToken: args?.inbox_token,
    mcpToken:   args?.mcp_token,
  })
  if (!result.ok) throw new Error(`auth failed: ${result.reason}`)
}
