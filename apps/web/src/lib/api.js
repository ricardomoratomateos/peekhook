async function request(path, options = {}) {
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json', ...options.headers },
    ...options,
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

  streamUrl: (token) => `/api/inboxes/${token}/stream`,

  getSchemaHistory: (token) => request(`/api/inboxes/${token}/schema-history`),

  regenerateMcpToken: (token) =>
    request(`/api/inboxes/${token}/regenerate-mcp`, { method: 'POST', body: '{}' }),

  replayEvent: (token, eventId) =>
    request(`/api/inboxes/${token}/replay`, {
      method: 'POST',
      body: JSON.stringify({ eventId, mockOnly: true }),
    }),
}
