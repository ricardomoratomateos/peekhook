/**
 * Tool — pure dataclass describing a single MCP tool.
 *
 * Handlers are async `(args, ctx) => result`. `ctx` is the per-request
 * context threaded in by the dispatcher — for HTTP it carries
 * `{ inboxToken }` resolved by Bearer-token authentication.
 *
 * The dispatcher in `infra/mcp.http.js` calls `tool.handler(args, ctx)`
 * after the transport has authenticated the request.
 */
export class Tool {
  /**
   * @param {{
   *   name: string,
   *   description: string,
   *   inputSchema: object,
   *   handler: (args: object, ctx: object) => Promise<any>,
   * }} props
   */
  constructor({ name, description, inputSchema, handler }) {
    if (typeof name !== 'string' || name.length === 0) {
      throw new Error('Tool.name must be a non-empty string')
    }
    if (typeof description !== 'string') {
      throw new Error('Tool.description must be a string')
    }
    if (inputSchema !== undefined && (typeof inputSchema !== 'object' || inputSchema === null)) {
      throw new Error('Tool.inputSchema must be an object')
    }
    if (typeof handler !== 'function') {
      throw new Error('Tool.handler must be a function')
    }
    this.name        = name
    this.description = description
    this.inputSchema = inputSchema
    this.handler     = handler
  }
}
