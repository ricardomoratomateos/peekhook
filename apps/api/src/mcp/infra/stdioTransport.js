import readline from 'node:readline'

/**
 * stdioTransport — JSON-RPC 2.0 over stdin/stdout.
 *
 * Reads one JSON object per line from stdin. Each object is
 * dispatched to the provided list/call hooks. Per spec, supports:
 *   - "tools/list"  → advertises available tools
 *   - "tools/call"  → invokes a tool by name with arguments
 *
 * Other methods return a JSON-RPC method-not-found error. Parse
 * errors reply with -32700. Unknown requests give -32600.
 *
 * Designed to run as a long-lived child process: stdout is held open
 * by `readline`, the dispatcher is async, and `close()` shuts down
 * the read interface.
 *
 * @param {{
 *   stdin?: NodeJS.ReadableStream,
 *   stdout?: NodeJS.WritableStream,
 *   listTools: () => Array<{ name: string, description: string, inputSchema: object }>,
 *   callTool:   (name: string, args: object) => Promise<any>,
 * }} opts
 * @returns {{ close: () => void }}
 */
export function stdioTransport({ stdin = process.stdin, stdout = process.stdout, listTools, callTool }) {
  const rl = readline.createInterface({ input: stdin, crlfDelay: Infinity })

  rl.on('line', (line) => {
    const trimmed = line.trim()
    if (!trimmed) return
    let msg
    try {
      msg = JSON.parse(trimmed)
    } catch (_err) {
      write(stdout, { jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } })
      return
    }
    dispatch(msg, listTools, callTool)
      .then((response) => { if (response !== null) write(stdout, response) })
      .catch((err) => write(stdout, {
        jsonrpc: '2.0',
        id: null,
        error: { code: -32603, message: err && err.message ? err.message : 'Internal error' },
      }))
  })

  return { close: () => rl.close() }
}

function write(stream, obj) {
  stream.write(JSON.stringify(obj) + '\n')
}

async function dispatch(msg, listTools, callTool) {
  if (msg === null || typeof msg !== 'object') {
    return { jsonrpc: '2.0', id: null, error: { code: -32600, message: 'Invalid Request' } }
  }
  if (msg.jsonrpc !== '2.0') {
    return { jsonrpc: '2.0', id: msg.id ?? null, error: { code: -32600, message: 'Invalid Request' } }
  }
  const id = msg.id ?? null
  const method = msg.method
  const params = msg.params ?? {}

  try {
    if (method === 'tools/list') {
      return { jsonrpc: '2.0', id, result: { tools: listTools() } }
    }
    if (method === 'tools/call') {
      const name = params.name
      const args = params.arguments ?? {}
      if (typeof name !== 'string') {
        return { jsonrpc: '2.0', id, error: { code: -32602, message: 'params.name required' } }
      }
      const result = await callTool(name, args)
      return { jsonrpc: '2.0', id, result }
    }
    return { jsonrpc: '2.0', id, error: { code: -32601, message: `Method not found: ${method}` } }
  } catch (err) {
    return {
      jsonrpc: '2.0',
      id,
      error: { code: -32000, message: err && err.message ? err.message : 'Internal error' },
    }
  }
}
