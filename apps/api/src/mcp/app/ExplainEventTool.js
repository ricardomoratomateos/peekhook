/**
 * explain_event tool handler.
 *
 * Provider fingerprint detection (priority order, first match wins):
 *   1. github  — headers include `x-github-event`
 *   2. linear  — `headers['user-agent']` contains `Linear-Webhook`
 *   3. stripe  — body parses as JSON object containing both `data`
 *                AND a top-level `object` key
 *   4. unknown — everything else
 *
 * Returns `{ provider, summary, fields, field_count }`. `fields` is a
 * flat `[{ path, type }]` listing of the body tree (recursive), so an
 * agent can read both the human summary and the structural shape in
 * one round trip.
 */
export class ExplainEventTool {
  /**
   * @param {{ event: object }} args (already authenticated + fetched
   *   by the dispatcher; `event` is the DTO from the read model)
   * @returns {{
   *   provider: 'stripe' | 'github' | 'linear' | 'unknown',
   *   summary: string,
   *   fields: Array<{ path: string, type: string }>,
   *   field_count: number,
   * }}
   */
  async execute({ event }) {
    if (!event || typeof event !== 'object') {
      throw new Error('explain_event requires the event document')
    }
    return explain(event)
  }
}

export function explain(event) {
  const headers = lowerKeys(event.headers ?? {})
  const bodyJson = safeParseJson(event.body)

  if (typeof headers['x-github-event'] === 'string') {
    const fields = describeFields(event, bodyJson)
    return {
      provider: 'github',
      summary: `GitHub event: ${headers['x-github-event']}`,
      fields,
      field_count: fields.length,
    }
  }

  const ua = readFirst(headers['user-agent'])
  if (typeof ua === 'string' && ua.includes('Linear-Webhook')) {
    const fields = describeFields(event, bodyJson)
    return {
      provider: 'linear',
      summary: `Linear webhook (user-agent: ${ua})`,
      fields,
      field_count: fields.length,
    }
  }

  const topKeys = bodyJson && typeof bodyJson === 'object' && !Array.isArray(bodyJson)
    ? Object.keys(bodyJson)
    : []
  if (topKeys.includes('data') && topKeys.includes('object')) {
    const objField = typeof bodyJson.object === 'string' ? bodyJson.object : null
    const fields = describeFields(event, bodyJson)
    return {
      provider: 'stripe',
      summary: objField ? `Stripe event: ${objField}` : 'Stripe event',
      fields,
      field_count: fields.length,
    }
  }

  const fields = describeFields(event, bodyJson)
  return {
    provider: 'unknown',
    summary: `Unknown webhook (${event.method ?? 'POST'} ${event.path ?? ''})`.trim(),
    fields,
    field_count: fields.length,
  }
}

function lowerKeys(obj) {
  const out = {}
  for (const [k, v] of Object.entries(obj ?? {})) out[k.toLowerCase()] = v
  return out
}

function readFirst(v) {
  if (Array.isArray(v)) return v[0]
  return v
}

function safeParseJson(raw) {
  if (typeof raw !== 'string') return (raw && typeof raw === 'object') ? raw : null
  try { return JSON.parse(raw) } catch { return null }
}

function describeFields(event, bodyJson) {
  if (bodyJson && typeof bodyJson === 'object' && !Array.isArray(bodyJson)) {
    return walk(bodyJson, '')
  }
  return Object.keys(event.headers ?? {}).map((k) => ({ path: `headers.${k}`, type: 'string' }))
}

function walk(obj, prefix) {
  const out = []
  for (const [k, v] of Object.entries(obj)) {
    const path = prefix ? `${prefix}.${k}` : k
    if (v === null) out.push({ path, type: 'null' })
    else if (Array.isArray(v)) out.push({ path, type: `array(${v.length})` })
    else if (typeof v === 'object') {
      out.push({ path, type: 'object' })
      out.push(...walk(v, path))
    } else {
      out.push({ path, type: typeof v })
    }
  }
  return out
}
