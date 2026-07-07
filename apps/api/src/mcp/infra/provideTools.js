import { Tool } from '../domain/Tool.js'
import { ListEventTool } from '../app/ListEventTool.js'
import { GetEventTool } from '../app/GetEventTool.js'
import { SearchEventsTool } from '../app/SearchEventsTool.js'
import { DiffEventsTool } from '../app/DiffEventsTool.js'
import { ExplainEventTool } from '../app/ExplainEventTool.js'
import { safeEvent } from '../app/SafeResponse.js'

/**
 * provideTools — wires the MCP tool surface from raw ports.
 *
 * Prompt-injection wrappers (see `app/SafeResponse.js`) are applied
 * here, AFTER the use case returns, so the use cases remain pure
 * fetchers and the safe projection lives at the transport boundary.
 *
 *   - `list_events`    — DTOs are already body-free (read model strips
 *                        body) and small. Left as-is.
 *   - `get_event`      — has access to the full body because callers
 *                        sometimes need it (debugging JSON contracts,
 *                        replaying with mutations). Default
 *                        `includeBody: false` opts the caller OUT of
 *                        the body; passing `includeBody: true` opts
 *                        back in. Even with `includeBody: true`, the
 *                        body is still wrapped in `userControlled: true`
 *                        and capped at 1 KB.
 *   - `search_events`  — list of DTOs. Each is replaced with the safe
 *                        projection (no raw body, top-level body
 *                        fields extracted + capped).
 *   - `diff_events`    — two full DTOs + diffs. Each side is
 *                        replaced with the safe projection; the diffs
 *                        are the LCS line output (no body content
 *                        beyond what the caller asked for).
 *   - `explain_event`  — already returns `{ provider, summary, fields }`
 *                        with `fields` listing paths and types only.
 *                        Left as-is.
 *
 * @param {{
 *   readModel:   import('../inbox/domain/RequestListReadModel.js').RequestListReadModel,
 *   searchModel: import('../domain/RequestSearchReadModel.js').RequestSearchReadModel,
 * }} ports
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
      description: 'List the most recent captured webhook events for the authenticated inbox. Cursor-paginated; limit defaults to 50, max 200. DTOs are body-free.',
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
      description: 'Fetch a single captured event by id. By default the response is a safe projection with top-level body fields (each marked userControlled, capped at 1 KB). Pass includeBody=true to receive the full body, still wrapped and capped.',
      inputSchema: {
        type: 'object',
        required: ['event_id'],
        properties: {
          event_id:    { type: 'string', description: 'Captured request id (ObjectId hex)' },
          includeBody: { type: 'boolean', default: false, description: 'Opt in to receiving the raw body (still wrapped in userControlled, capped at 1 KB)' },
        },
      },
      handler: async (args, ctx) => {
        const dto = await getEv.execute({ inbox_token: ctx.inboxToken, event_id: args.event_id })
        if (!dto) throw new Error(`event (${args.event_id}) not found`)
        return safeEvent(dto, { includeBody: args.includeBody === true })
      },
    }),
    new Tool({
      name: 'search_events',
      description: 'Apply a regex to request path, body, or a specific header. Limit 50 results. Each match is returned as a safe projection (top-level body fields extracted, capped at 1 KB, marked userControlled).',
      inputSchema: {
        type: 'object',
        required: ['regex'],
        properties: {
          regex:      { type: 'string', description: 'Substring pattern (case-insensitive; metacharacters escaped)' },
          field:      { type: 'string', enum: ['path', 'header', 'body'], default: 'path' },
          header_key: { type: 'string', description: 'Required when field="header"' },
        },
      },
      handler: async (args, ctx) => {
        const result = await searchEv.execute({ inbox_token: ctx.inboxToken, ...args })
        return { events: result.events.map((dto) => safeEvent(dto)) }
      },
    }),
    new Tool({
      name: 'diff_events',
      description: 'Compare two captured events by id. Returns safe projections for both sides (no raw body; top-level body fields extracted + capped) plus a header-level diff and a line-level body diff.',
      inputSchema: {
        type: 'object',
        required: ['event_a_id', 'event_b_id'],
        properties: {
          event_a_id: { type: 'string' },
          event_b_id: { type: 'string' },
        },
      },
      handler: async (args, ctx) => {
        const result = await diffEv.execute({ inbox_token: ctx.inboxToken, ...args })
        return {
          a:          safeEvent(result.a),
          b:          safeEvent(result.b),
          header_diff: result.header_diff,
          body_diff:   result.body_diff,
        }
      },
    }),
    new Tool({
      name: 'explain_event',
      description: 'Detect the webhook provider (Stripe / GitHub / Linear / unknown) and return a one-line summary plus the body schema shape (paths + types only, no values).',
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