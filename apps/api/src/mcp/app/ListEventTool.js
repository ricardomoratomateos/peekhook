/**
 * list_events tool handler.
 *
 * Returns paginated DTOs from `MongoRequestListReadModel.list(...)`.
 * Auth is performed upstream in `provideTools.assertAuth`; this
 * handler just delegates to the read model with the verified
 * inbox token.
 *
 * The unused `_readModel` capture keeps the tool aligned with the
 * constructor-dep pattern used by sibling use cases.
 */
export class ListEventTool {
  constructor({ readModel }) {
    this.readModel = readModel
  }

  /**
   * @param {{ inbox_token: string, limit?: number, before?: string }} args
   *   (already authenticated by the dispatcher; `inbox_token` is the
   *   inbox this call is bound to)
   * @returns {Promise<{ events: object[] }>}
   *   Wrapper shape — `{events: [...]}` keeps the JSON-RPC response
   *   object-shaped so MCP clients can introspect named fields.
   */
  async execute({ inbox_token, limit, before }) {
    const events = await this.readModel.list({ inboxToken: inbox_token, limit, before })
    return { events }
  }
}
