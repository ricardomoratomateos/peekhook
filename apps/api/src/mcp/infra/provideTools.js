import { Tool } from '../domain/Tool.js'
import { ListEventTool } from '../app/ListEventTool.js'
import { GetEventTool } from '../app/GetEventTool.js'
import { SearchEventsTool } from '../app/SearchEventsTool.js'
import { DiffEventsTool } from '../app/DiffEventsTool.js'
import { ExplainEventTool } from '../app/ExplainEventTool.js'

/**
 * provideTools — wires the MCP tool surface from raw ports.
 *
 * Takes:
 *   - readModel    : existing `RequestListReadModel` (list + findById)
 *   - searchModel  : `RequestSearchReadModel` (path/header/body regex)
 *
 * Returns:
 *   - listTools : plain projection for transport advertisement
 *   - callTool  : dispatcher `(name, args, ctx) => Promise<result>`
 *
 * The dispatcher:
 *   - looks up the tool by name and invokes its `handler(args, ctx)`.
 *   - `ctx.inboxToken` is resolved by the transport via Bearer-token
 *     authentication (see `mcp.http.js`) and threaded into handlers
 *     that need to scope by inbox.
 *
 * No per-call authentication is performed here — auth happens at the
 * transport layer, so the input schemas only describe arguments the
 * caller supplies (event_id, regex, etc.), not credentials.
 */
export function provideTools({ readModel, searchModel }) {
  const listEv   = new ListEventTool({ readModel })
  const getEv    = new GetEventTool({ readModel })
  const searchEv = new SearchEventsTool({ readModel: searchModel })
  const diffEv   = new DiffEventsTool({ readModel })
  const explainEv = new ExplainEventTool()

  const tools = [
    new Tool({
      name: 'list_events',
      description: 'List the most recent captured webhook events for the authenticated inbox. Cursor-paginated; limit defaults to 50, max 200.',
      inputSchema: {
        type: 'object',
        properties: {
          limit:  { type: 'integer', minimum: 1, maximum: 200, default: 50 },
          before: { type: 'string', description: 'Cursor (ObjectId) — return events strictly older than this id' },
        },
      },
      handler: async (args, ctx) => listEv.execute({ inbox_token: ctx.inboxToken, ...args }),
    }),
    new Tool({
      name: 'get_event',
      description: 'Fetch a single captured event by id. Body is decoded as JSON when content-type is JSON.',
      inputSchema: {
        type: 'object',
        required: ['event_id'],
        properties: {
          event_id: { type: 'string', description: 'Captured request id (ObjectId hex)' },
        },
      },
      handler: async (args, ctx) => getEv.execute({ inbox_token: ctx.inboxToken, ...args }),
    }),
    new Tool({
      name: 'search_events',
      description: 'Apply a regex to request path, body, or a specific header. Limit 50 results.',
      inputSchema: {
        type: 'object',
        required: ['regex'],
        properties: {
          regex:      { type: 'string', description: 'Substring pattern (case-insensitive; metacharacters escaped)' },
          field:      { type: 'string', enum: ['path', 'header', 'body'], default: 'path' },
          header_key: { type: 'string', description: 'Required when field="header"' },
        },
      },
      handler: async (args, ctx) => searchEv.execute({ inbox_token: ctx.inboxToken, ...args }),
    }),
    new Tool({
      name: 'diff_events',
      description: 'Compare two captured events by id: lists header differences and a line-level body diff.',
      inputSchema: {
        type: 'object',
        required: ['event_a_id', 'event_b_id'],
        properties: {
          event_a_id: { type: 'string' },
          event_b_id: { type: 'string' },
        },
      },
      handler: async (args, ctx) => diffEv.execute({ inbox_token: ctx.inboxToken, ...args }),
    }),
    new Tool({
      name: 'explain_event',
      description: 'Detect the webhook provider (Stripe / GitHub / Linear / unknown) and return a one-line summary plus the body schema shape.',
      inputSchema: {
        type: 'object',
        required: ['event_id'],
        properties: {
          event_id: { type: 'string' },
        },
      },
      handler: async (args, ctx) => {
        const dto = await getEv.execute({ inbox_token: ctx.inboxToken, event_id: args.event_id })
        if (!dto) throw new Error(`event (${args.event_id}) not found`)
        return explainEv.execute({ event: dto })
      },
    }),
  ]

  const byName = new Map(tools.map((t) => [t.name, t]))

  return {
    tools,
    listTools: () => tools.map((t) => ({
      name:        t.name,
      description: t.description,
      inputSchema: t.inputSchema,
    })),
    callTool: async (name, args, ctx) => {
      const tool = byName.get(name)
      if (!tool) throw new Error(`unknown tool: ${name}`)
      return tool.handler(args, ctx)
    },
  }
}
