export const RESPONSE_PRESETS = {
  status: [
    { v: 200, l: '200 ok' },
    { v: 201, l: '201 created' },
    { v: 400, l: '400 bad request' },
    { v: 401, l: '401 unauthorized' },
    { v: 403, l: '403 forbidden' },
    { v: 404, l: '404 not found' },
    { v: 422, l: '422 unprocessable' },
    { v: 429, l: '429 rate limited' },
    { v: 500, l: '500 server error' },
    { v: 502, l: '502 bad gateway' },
    { v: 503, l: '503 unavailable' },
  ],
  contentType: [
    { v: 'application/json',  l: 'json' },
    { v: 'text/plain',         l: 'text' },
  ],
}

export const RESPONSE_DEFAULTS = { enabled: false, status: 200, contentType: 'application/json', body: '{"ok":true}' }
