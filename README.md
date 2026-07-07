# PeekHook

A free, anonymous webhook inspector. No signup, expires in 7 days.

Send any HTTP request to `peekhook.dev/i/<token>`. The request
turns up live in the inspector UI: method, headers, query, body,
IP, content-type, size. Configure a custom mock reply (status,
content-type, body) to simulate downstream failures and test
your retry logic.

## Quick start

```bash
# requires Node 20+, MongoDB 7+
npm install
npm run dev
```

- Frontend: http://localhost:5173
- Backend:  http://localhost:3000

If MongoDB is not running locally:

```bash
brew install mongodb-community && brew services start mongodb-community
```

or set `MONGODB_URI` to any reachable Mongo URL.

## What you can do today

- Capture any non-GET HTTP method (POST/PUT/PATCH/DELETE) at `/i/:token`
- Live SSE stream of new captures in the browser
- Inspect method, headers, query params, body, IP, content-type, size
- Configure a static mock reply (status + content-type + body)
- Auto-expire after 7 days (TTL on the inbox)

## Try it

```bash
# 1. mint an inbox
curl -X POST http://localhost:3000/api/inboxes -d '{}'
# → { token: "...", url: "http://localhost:3000/i/...", expiresAt: "..." }

# 2. send a webhook
curl -X POST http://localhost:3000/i/<token> \
  -H 'content-type: application/json' \
  -d '{"event":"hello","amount":42}'

# 3. open the inspector
open http://localhost:5173/i/<token>
```

## Architecture

Monorepo with two apps, each layered per use case
(domain → app → infra). Each use case (Capture, Reply, List)
keeps its domain aggregate, ports, and use case in
`apps/api/src`, and the inspector UI is wired straight at
those routes:

```
apps/
  api/   Fastify + MongoDB, captures at /i/:token, reads at /api/inboxes/...
  web/   Vite + React 18, no SSR, Inspector UI
```

API surface:

| Method | Route                                  | Purpose                       |
| ------ | -------------------------------------- | ----------------------------- |
| POST   | `/api/inboxes`                         | mint an inbox, returns token  |
| GET    | `/api/inboxes/:token`                  | inbox metadata                |
| GET    | `/api/inboxes/:token/requests`         | paginated list of captures    |
| GET    | `/api/inboxes/:token/requests/:id`     | single capture by id          |
| PUT    | `/api/inboxes/:token/response`         | configure mock reply          |
| DELETE | `/api/inboxes/:token/response`         | clear mock reply              |
| GET    | `/api/inboxes/:token/stream`           | SSE stream of new captures    |
| POST   | `/i/:token`                            | capture endpoint              |

GET on `/i/:token` returns 405. It is reserved for the
inspector UI, not for capture.

## Design system

Monochrome canvas (`#0a0a0a` background, dark surface stack)
with a single electric-lime accent (`#c8ff00`). Geist Sans for
UI, Geist Mono for data. See [DESIGN.md](./DESIGN.md) for the
full token table.

## Roadmap

See [ROADMAP.md](./ROADMAP.md) for the prioritized feature
plan, the explicit "won't build until demand" list, and the
open product questions we're deferring until we have users.

## Status

v1.1 shipped. All 16 candidate features and all 16 security /
business limits landed. 319 / 319 backend tests passing
across 37 files. Self-host via `docker compose up` (mongo +
api + web with healthchecks and an SSE-friendly nginx in
front of the web bundle). Public deploy — fly.io (API) +
Cloudflare Pages (web) + `peekhook.dev` domain — is the
next concrete step; not yet wired. See
[ROADMAP.md](./ROADMAP.md) for the full security audit and
the open questions.
