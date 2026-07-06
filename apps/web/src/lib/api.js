async function request(path, options = {}) {
  const hasBody = options.body !== undefined && options.body !== null
  const headers = hasBody
    ? { 'Content-Type': 'application/json', ...options.headers }
    : { ...options.headers }

  const res = await fetch(path, {
    ...options,
    headers,
  })

  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    const err = new Error(body.error || `HTTP ${res.status}`)
    err.status = res.status
    throw err
  }

  return res.json()
}

export const api = {
  createInbox: () => request('/api/inboxes', { method: 'POST', body: '{}' }),

  getInbox: (token) => request(`/api/inboxes/${token}`),

  getRequests: (token) => request(`/api/inboxes/${token}/requests`),

  getRequest: (token, id) => request(`/api/inboxes/${token}/requests/${id}`),

  setResponse: (token, responseConfig) =>
    request(`/api/inboxes/${token}/response`, {
      method: 'PUT',
      body: JSON.stringify(responseConfig),
    }),

  clearResponse: (token) =>
    request(`/api/inboxes/${token}/response`, { method: 'DELETE' }),

  setForward: (token, forwardTo) =>
    request(`/api/inboxes/${token}/forward`, {
      method: 'PUT',
      body: JSON.stringify({ forwardTo }),
    }),

  clearForward: (token) =>
    request(`/api/inboxes/${token}/forward`, { method: 'DELETE' }),

  streamUrl: (token) => `/api/inboxes/${token}/stream`,

  getSchemaHistory: (token) => request(`/api/inboxes/${token}/schema-history`),

  getSharedRequest: (id) => request(`/api/requests/${id}`),

  regenerateMcpToken: (token) =>
    request(`/api/inboxes/${token}/regenerate-mcp`, { method: 'POST', body: '{}' }),

  listFixtures: () => request('/api/fixtures'),

  searchEvents: (token, { regex, field, limit, before }) => {
    const params = new URLSearchParams()
    if (regex) params.set('regex', regex)
    if (field) params.set('field', field)
    if (limit) params.set('limit', String(limit))
    if (before) params.set('before', before)
    return request(`/api/inboxes/${token}/requests/search?${params.toString()}`)
  },

  sendFixture: (token, fixtureId) =>
    request(`/api/inboxes/${token}/fixtures/${fixtureId}`, { method: 'POST', body: '{}' }),

  replayEvent: (token, eventId) =>
    request(`/api/inboxes/${token}/replay`, {
      method: 'POST',
      body: JSON.stringify({ eventId, mockOnly: true }),
    }),
}
