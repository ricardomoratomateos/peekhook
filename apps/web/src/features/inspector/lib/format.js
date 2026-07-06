import { c } from './tokens.js'

export function timeAgo(date) {
  if (!date) return '—'
  const sec = Math.floor((Date.now() - new Date(date)) / 1000)
  if (sec < 5) return 'just now'
  if (sec < 60) return `${sec}s ago`
  if (sec < 3600) return `${Math.floor(sec / 60)}m ago`
  if (sec < 86400) return `${Math.floor(sec / 3600)}h ago`
  return new Date(date).toLocaleDateString()
}

export function formatSize(bytes) {
  if (!bytes && bytes !== 0) return '—'
  if (bytes === 0) return '0 B'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export function methodTone(method) {
  return ['POST', 'PUT', 'PATCH', 'DELETE'].includes((method || '').toUpperCase())
    ? { color: c.fg, weight: 500 }
    : { color: c.dim, weight: 400 }
}

export function formatBody(body, contentType) {
  if (body == null || body === '') return null
  const ct = (contentType || '').toLowerCase()
  if (ct.includes('json')) {
    if (typeof body === 'object') return JSON.stringify(body, null, 2)
    try { return JSON.stringify(JSON.parse(body), null, 2) } catch (_) {}
  }
  if (typeof body === 'object') return JSON.stringify(body, null, 2)
  return String(body)
}

export function prettyPath(path, token) {
  if (!path) return '/'
  const prefix = `/i/${token}`
  if (path.startsWith(prefix)) return path.slice(prefix.length) || '/'
  return path
}

export function resolveInboxUrl(token, state) {
  const origin = typeof window !== 'undefined' && window.location?.origin ? window.location.origin : ''
  const apiBase = (import.meta.env.VITE_API_URL || '').replace(/\/$/, '')
  let storedUrl
  try { storedUrl = JSON.parse(localStorage.getItem(`peekhook-${token}`) || '{}')?.url } catch (_) {}
  const raw = state?.url
    || storedUrl
    || `${apiBase || origin}/i/${token}`
  try {
    return new URL(raw, origin || undefined).toString()
  } catch (_) {
    return `${origin}/i/${token}`
  }
}

export function resolveMcpToken(token, state) {
  if (state?.mcpToken) return state.mcpToken
  try {
    const stored = JSON.parse(localStorage.getItem(`peekhook-${token}`) || '{}')
    if (stored.mcpToken) return stored.mcpToken
  } catch (_) {}
  return null
}

export function buildTestCurl(inboxUrl) {
  return `curl -s -X POST ${inboxUrl || '<your-inbox-url>'} \\
  -H "content-type: application/json" \\
  -w "\\nHTTP %{http_code}\\n" \\
  -d '{"event":"test","hello":"world"}'`
}
