const FILLER_WORDS = new Set([
  'events', 'event', 'over', 'above', 'below', 'under', 'with', 'from',
  'last', 'recent', 'today', 'yesterday', 'this', 'that', 'the', 'a',
  'in', 'for', 'on', 'show', 'me', 'all', 'any', 'where', 'which',
  'have', 'has', 'having', 'and', 'or', 'is', 'are', 'was', 'were',
  'get', 'find', 'list', 'show', 'please', 'thanks', 'webhook',
  'webhooks', 'request', 'requests', 'capture', 'captures',
])

const PROVIDER_KEYWORDS = {
  stripe: ['stripe', 'payment', 'charge', 'intent', 'subscription', 'invoice'],
  github: ['github', 'push', 'pull', 'commit', 'repo', 'repository', 'merge'],
  linear: ['linear', 'issue', 'task', 'project', 'comment'],
}

const HEADER_KEYWORDS = {
  'header:user-agent': ['agent', 'browser', 'user-agent', 'useragent'],
  'header:x-github-event': ['github-event', 'gh-event', 'webhook-event'],
}

export function parseNaturalLanguage(query) {
  if (!query || typeof query !== 'string') {
    return { regex: '', field: 'body', provider: null, amount: null }
  }

  const original = query.trim()
  const lower = original.toLowerCase()
  const tokens = lower
    .replace(/[^\w\s$><=]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)

  let provider = null
  for (const [name, keywords] of Object.entries(PROVIDER_KEYWORDS)) {
    if (keywords.some(k => lower.includes(k))) {
      provider = name
      break
    }
  }

  let headerField = null
  for (const [field, keywords] of Object.entries(HEADER_KEYWORDS)) {
    if (keywords.some(k => lower.includes(k))) {
      headerField = field
      break
    }
  }

  let amount = null
  const over = lower.match(/(?:over|above|>|>=|greater than|more than)\s*\$?\s*(\d+(?:\.\d+)?)/)
  const under = lower.match(/(?:under|below|<|<=|less than|fewer than)\s*\$?\s*(\d+(?:\.\d+)?)/)
  if (over) amount = { op: '>=', value: parseFloat(over[1]) }
  else if (under) amount = { op: '<=', value: parseFloat(under[1]) }

  const meaningful = tokens
    .filter(t => t.length > 1 && !FILLER_WORDS.has(t) && !/^[\d.]+$/.test(t) && !/^[<>]=?$/.test(t))
    .filter(t => !Object.values(PROVIDER_KEYWORDS).flat().includes(t))
    .filter(t => !Object.values(HEADER_KEYWORDS).flat().includes(t))

  const parts = []
  if (amount) {
    const n = amount.value
    const len = String(Math.floor(n)).length
    const min = Math.floor(n / Math.pow(10, len - 1)) || 1
    const max = Math.ceil((n + 1) / Math.pow(10, len - 1)) || 9
    parts.push(amount.op === '>='
      ? `[${min}-9][0-9]{${len - 1},}`
      : `[0-${min - 1}][0-9]{${len - 1}}`)
  }
  if (meaningful.length) {
    parts.push(meaningful.join('|'))
  } else if (provider) {
    parts.push(provider)
  }
  if (parts.length === 0) {
    return { regex: '', field: 'body', provider, amount, headerField, originalQuery: original }
  }

  let regex = parts.join('|')
  try {
    new RegExp(regex)
  } catch (_) {
    regex = meaningful.join('|') || provider || ''
  }

  let field = 'body'
  if (headerField) field = headerField
  else if (provider && /path|route|url|endpoint/i.test(lower)) field = 'path'

  return { regex, field, provider, amount, headerField, originalQuery: original }
}
