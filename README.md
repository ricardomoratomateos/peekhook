# peekhook

A free, anonymous webhook inspector. No signup, expires in 7 days.

Send any HTTP request to `peekhook.0311b.com/i/<token>`. The request
turns up live in the inspector UI: method, headers, query, body,
IP, content-type, size. Configure a custom mock reply (status,
content-type, body) to simulate downstream failures and test
your retry logic.

Two ways to run it:

- **Hosted** — the public, ephemeral instance (Mongo-backed).
- **Local-first** — `peekgrok`, a single self-contained binary
  that runs the whole stack on your machine over SQLite, no
  Mongo, no signup, data stays in `~/.peekhook`. It can also act
  as a transparent sniffer in front of your own app — an
  ngrok-style inspector that captures every request *and* response
  while forwarding traffic through. See
  [Run it locally](#run-it-locally-peekgrok-cli).

## Quick start

```bash
# requires Node 20+, pnpm 10+, MongoDB 7+
pnpm install
pnpm dev
```

- Frontend: http://localhost:5173
- Backend:  http://localhost:3000

If MongoDB is not running locally:

```bash
brew install mongodb-community && brew services start mongodb-community
```

or set `MONGODB_URI` to any reachable Mongo URL.

## What you can do today

- Capture POST/PUT/PATCH/DELETE at `/i/:token` — plus non-browser GET
  (OAuth callbacks, verification pings): a GET is captured unless it's a
  browser navigation (`Accept: text/html`), which still gets a 405
  pointing at the inspector
- Live SSE stream of new captures in the browser
- Inspect method, headers, query params, body, IP, content-type, size
- Configure a static mock reply (status + content-type + body), with an
  optional **response delay** (0–30s) to simulate a slow / timing-out
  upstream and exercise your client's retry logic
- **Filter what gets logged** with a per-inbox allowlist — match on
  method, path globs (`/api/*`), or header / query rules. Requests that
  don't match still get a reply but aren't captured (and don't count
  against the 1,000-capture cap), so you can point a noisy app at
  `peekgrok` and only keep the endpoint you care about
- **Replay** a captured event against the mock reply, or against the
  inbox's configured forward target — optionally **editing** the method
  and body first (the tweak-and-re-send debug loop)
- **Export** all captures as a downloadable JSON document, and **clear**
  an inbox's captures (frees the 1,000-capture cap without minting a new
  URL)
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

## Run it locally (peekgrok CLI)

`peekgrok` is a single self-contained binary that runs the full
peekhook stack — capture endpoint, inspector UI, SSE stream, and
MCP server — on your machine, backed by SQLite instead of Mongo.
No database to install, no signup; data lives in
`~/.peekhook/peekgrok.db`.

```bash
# requires Bun (https://bun.sh)
cd apps/cli
bun run build            # compile to dist/peekgrok (current arch)
./dist/peekgrok listen --to 8080
```

It runs in one of two modes.

### Sniffer mode (`--to`) — the ngrok inspector

Point `--to` at your running app and peekgrok becomes a
transparent reverse proxy in front of it: every request is
captured and forwarded upstream, and the upstream's **response**
is recorded too. Your app keeps working while you inspect the full
request/response of everything passing through.

```bash
peekgrok listen --to 8080 --ngrok-url my.ngrok.app
```

```
public ngrok URL ──▶ peekgrok proxy (:4042, captured) ──▶ your app (:8080)
                     inspector (:4041) ◀── you watch here, live
```

ngrok tunnels the **proxy** port (`:4042`); the inspector, `/api`,
and MCP stay on a separate local port (`:4041`), mirroring ngrok's
own `:4040` inspector. Enabling a mock reply in the UI
short-circuits the forward, so you can simulate upstream failures
on demand. Replace your direct `ngrok http 8080` with the command
above — the public URL still reaches your app, but now you see
every exchange.

### Webhook-inbox mode (no `--to`)

Without `--to`, peekgrok is a classic webhook sink: it tunnels an
inbox and prints a ready-to-paste `https://<tunnel>/i/<token>`.
Requests terminate at the inbox (captured, with an optional mock
reply); your app is not involved.

```bash
peekgrok listen
```

### Inbox reuse

peekgrok reuses the inbox from your last run — same webhook URL,
captured history, and MCP token — as long as it still exists in
the db (stashed in a `0600` `session.json` beside the database).
Pass `--fresh` to force a new one. The inspector URL it prints
carries the MCP bearer token in the fragment (`#mcp=…`) so the MCP
tab shows it automatically; the token never touches the server.

### Share links

When a tunnel is up, the inspector's **share** button builds a
`/c/<id>` link against the public ngrok URL, not `localhost`, so you
can hand it to a teammate. In webhook-inbox mode ngrok exposes the
inspector directly. In sniffer mode ngrok points at your app, so
peekgrok reserves three path prefixes on the tunneled proxy —
`/c`, `/assets`, `/api/requests` — and serves those from the local
inspector instead of forwarding them (everything else still reaches
your app). If your app uses one of those prefixes it would be
shadowed; peekgrok prints the reserved set at startup. On the hosted
instance, share links use the request host (e.g. `peekhook.0311b.com`).

### Flags

- `--to <port|url>` — sniffer mode: forward all traffic to your app
  (`--to 8080` or `--to http://localhost:8080`).
- `--port <port>` — inspector / API / MCP port (default `4041`, local only).
- `--proxy-port <port>` — sniffer port ngrok tunnels (default `4042`).
- `--ignore <p1,p2,…>` — comma-separated path prefixes to forward but
  NOT capture, to keep noise (health checks, assets) out of the feed
  (e.g. `--ignore /health,/assets,/favicon.ico`).
- `--no-tunnel` — skip ngrok, serve on localhost only.
- `--ngrok-url <domain>` — use a reserved ngrok domain, e.g. `my.ngrok.app`.
- `--ngrok-region <r>` — ngrok region (omit to honor your
  `~/.config/ngrok/ngrok.yml`).
- `--data-dir <path>` — db location (default `~/.peekhook`; isolate sessions).
- `--fresh` — force a new inbox instead of reusing the last one.
- `--web-dist <path>` — point at a built `apps/web/dist` if the
  binary can't find it automatically (or set `PEEKHOOK_WEB_DIST`).

Cross-compile all targets (darwin/linux/windows) with
`bun run build:all` → `dist/peekgrok-<os>-<arch>`.

> **Note:** the proxy relays text responses (JSON/XML/HTML/plain) as
> UTF-8 and binary responses (images, fonts, octet-stream) as raw bytes,
> so binary assets pass through intact. The capture record stores a
> `[binary N bytes]` placeholder for binary bodies rather than the raw
> bytes.

## Architecture

pnpm workspaces monorepo with three apps, each backend module
layered per use case (domain → app → infra). Each use case
(Capture, Reply, List, …) keeps its domain aggregate, ports, and
use case in `apps/api/src`, and the inspector UI is wired straight
at those routes:

```
apps/
  api/   Fastify, captures at /i/:token, reads at /api/inboxes/...
  web/   Vite + React 18, no SSR, Inspector UI
  cli/   Bun binary (peekgrok): local-first stack over SQLite + ngrok,
         plus a catch-all reverse-proxy sniffer (src/proxyServer.js)
```

**Dual-target persistence.** `apps/api/src/app.js` exposes a
`buildApp(deps, options)` factory that composes the same Fastify
app from whatever persistence adapters it's handed. Two entry
points wire it:

- `src/index.js` — the hosted target. Wires the `Mongo*` adapters
  (`MongoInboxRepository`, …) against a shared MongoDB.
- `src/cli.js` — the local target used by `peekgrok`. Wires the
  `Sqlite*` adapters against a `bun:sqlite` database.

Every persistence port therefore has a `Mongo*` and a `Sqlite*`
implementation; the domain and app layers are identical across
both. Feature flags (`sseEnabled`, `mcpEnabled`, `shareEnabled`)
are passed as the factory's second argument.

API surface:

| Method | Route                                  | Purpose                       |
| ------ | -------------------------------------- | ----------------------------- |
| POST   | `/api/inboxes`                         | mint an inbox, returns token  |
| GET    | `/api/inboxes/:token`                  | inbox metadata                |
| GET    | `/api/inboxes/:token/requests`         | paginated list of captures    |
| GET    | `/api/inboxes/:token/requests/:id`     | single capture by id          |
| GET    | `/api/inboxes/:token/export`           | download all captures as JSON |
| DELETE | `/api/inboxes/:token/requests`         | clear captures + reset cap    |
| PUT    | `/api/inboxes/:token/response`         | configure mock reply          |
| DELETE | `/api/inboxes/:token/response`         | clear mock reply              |
| PUT    | `/api/inboxes/:token/forward`          | configure forward target      |
| POST   | `/api/inboxes/:token/replay`           | replay event (mock or forward)|
| GET    | `/api/inboxes/:token/stream`           | SSE stream of new captures    |
| POST   | `/i/:token`                            | capture endpoint              |

`POST /api/inboxes/:token/replay` takes `{ eventId, mode, mutations }`:
`mode` is `mock` (default — replay the inbox's own reply) or `forward`
(re-send to the inbox's configured `forwardTo`); `mutations` optionally
overrides `{ method, path, headers, body }` before replay.

A **browser** GET on `/i/:token` (`Accept: text/html`) returns 405 —
reserved for the inspector UI. A **non-browser** GET is captured, so
GET-based webhooks (OAuth callbacks, verification pings) work.

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

v1.3 shipped. All 16 candidate features and all 16 security /
business limits landed, plus the v1.3 usability batch (replay
to forward + edit-and-replay, mock-reply delay, GET capture,
export, clear-inbox, binary-safe sniffer + noise filter).
340 / 340 backend tests passing across 39 files. Two ways to run it: `docker compose up`
(mongo + api + web with healthchecks and an SSE-friendly
nginx in front of the web bundle), or the `peekgrok` local
CLI (SQLite + ngrok, no Mongo). A hosted instance runs at
`peekhook.0311b.com` (interim host); the move to the final
`peekhook.dev` domain (fly.io API + Cloudflare Pages web) is
still in progress. See [ROADMAP.md](./ROADMAP.md) for the full
security audit and the open questions.
