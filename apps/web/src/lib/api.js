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

  setCaptureFilter: (token, captureFilter) =>
    request(`/api/inboxes/${token}/capture-filter`, {
      method: 'PUT',
      body: JSON.stringify({ captureFilter }),
    }),

  clearCaptureFilter: (token) =>
    request(`/api/inboxes/${token}/capture-filter`, { method: 'DELETE' }),

  streamUrl: (token) => `/api/inboxes/${token}/stream`,

  getSchemaHistory: (token) => request(`/api/inboxes/${token}/schema-history`),

  getSharedRequest: (id, token) =>
    request(`/api/requests/${id}${token ? `?token=${encodeURIComponent(token)}` : ''}`),

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

  replayEvent: (token, eventId, { mode = 'mock', mutations = null } = {}) =>
    request(`/api/inboxes/${token}/replay`, {
      method: 'POST',
      body: JSON.stringify({ eventId, mode, mutations }),
    }),

  // Delete captures. Pass a non-empty `ids` array to delete only those;
  // omit it to clear the whole inbox (and reset its capture cap).
  clearRequests: (token, ids) =>
    request(`/api/inboxes/${token}/requests`, {
      method: 'DELETE',
      body: Array.isArray(ids) && ids.length > 0 ? JSON.stringify({ ids }) : undefined,
    }),

  // Download URL for the export. Pass `ids` to export only the selection.
  exportUrl: (token, ids) => {
    const base = `/api/inboxes/${token}/export`
    if (Array.isArray(ids) && ids.length > 0) {
      return `${base}?ids=${ids.map(encodeURIComponent).join(',')}`
    }
    return base
  },

  shareRequest: (token, id) =>
    request(`/api/inboxes/${token}/requests/${id}/share`, {
      method: 'POST',
      body: '{}',
    }),
}
