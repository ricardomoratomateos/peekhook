# Roadmap

peekhook is a free, anonymous webhook inspector. Public,
ephemeral, zero signup. The bet: developers want to look at
webhooks fast without configuring anything, and the current
incumbent (webhook.site) hasn't shipped serious new features
in years.

## Status (v1.3)

- **All 16 candidate features + 16 security/business limits shipped**,
  plus the v1.3 usability batch (replay-to-forward + edit-and-replay,
  mock-reply delay, GET capture, export, clear / delete-selected,
  binary-safe sniffer + noise filter, shareable peekgrok links).
- **Repo published**: `github.com/ricardomoratomateos/peekhook`, branch `main`.
- **Backend tests**: 340 / 340 (Vitest + mongodb-memory-server) across
  39 files, plus `bun:sqlite` / proxy integration tests under
  `apps/api/tests` and `apps/cli/tests`.
- **Frontend tests**: still the main gap — only `lib/diff.spec.js` in
  `apps/web`; the ~11 inspector components are unverified.
- **Package manager**: pnpm 10 (`pnpm-workspace.yaml` + `pnpm-lock.yaml`).
- **Hosted instance**: live at `peekhook.0311b.com` (interim host until
  `peekhook.dev` is bought). Run locally with `docker compose up`
  (mongo + api + web) or the `peekgrok` CLI (SQLite + ngrok).

The feature plan is complete; remaining work is polish (frontend tests,
NL-parser v2) and finishing the deploy/domain move to `peekhook.dev`.

## Direction

Stay tiny. Stay free. Don't add auth unless users ask for it
twice. The differentiated wedges are:

1. **Comparator**: diff two captures side-by-side, schema-drift
   over time, "find events where X changed A→B".
2. **AI-native surfacing**: MCP server, `explain_event`,
   provider fingerprint detection, schema-drift callouts,
   natural language search.

Reject the SaaS feature factory. Every new feature has to earn
its weight against the curl-then-look-at-the-Inspector flow.

## Locked-in stack decisions

- **Backend**: Fastify, dual-target persistence behind the
  `buildApp` DI factory. No breaking changes planned.
- **Frontend**: Vite + React 18 + react-router, no SSR.
- **CLI**: `peekgrok` (`apps/cli`), Bun-compiled single binary.
  Local-first stack over SQLite + optional ngrok tunnel.
- **Storage**: Mongo TTL 7 days (hosted) or `bun:sqlite` file
  in `~/.peekhook` (local). Single database either way.
- **Auth**: none, ever, unless pull justifies it.
- **Hosting**: interim instance live at `peekhook.0311b.com`.
  Target: API on fly.io free tier, web on Cloudflare Pages.
- **Domain**: interim `peekhook.0311b.com`; `peekhook.dev`
  (via Porkbun, ~$1.11/yr) still to be bought, then DNS cut over.
- **No Slack / Discord / Teams / email notifiers in MVP**.
  Browser notifications + MCP reach the same audience without
  wiring four more integrations.

## What ships today (user-visible surface)

- Inbox create + auto-delete after 7 days (TTL index).
- Capture POST/PUT/PATCH/DELETE at `/i/:token`, plus non-browser
  GET (OAuth callbacks, verification pings). A browser GET
  (`Accept: text/html`) returns 405, reserved for the Inspector SPA.
- Live SSE stream of new captures into the request list.
- Inspector UI: method, headers, query, body, IP, size, content-type
  for each captured request. Method chip + path + timestamp.
- Static mock reply (status + content-type + body, plus an optional
  0–30s response delay to simulate a slow upstream) configurable
  per inbox.
- Capture filter (allowlist) per inbox: only log requests matching
  the configured methods / path globs / header or query rules (AND
  across dimensions, OR within each). A non-matching request is still
  answered normally (mock reply / forward / ack) but is not persisted
  and consumes neither the 1,000-capture cap nor the rate window — the
  filter is evaluated before a capture slot is reserved. Works in both
  hosted and local `peekgrok` sniffer mode (shared `CaptureRequest`).
- "Copy as curl" button on every capture + the empty state.
- Inspector features: search input (regex + field selector +
  natural-language examples), schema sparkline sidebar panel
  (5s poll), MCP token card (with copy + curl-style usage
  snippet + regenerate button), two-event diff side-by-side
  (LCS body + header diff), replay button (against the mock reply
  or the inbox's configured forward target, with optional
  method/body edits; 1/min rate limit), schema-drift callout chip
  on DetailPanel, fixture buttons in EmptyState (Stripe / GitHub /
  Linear / generic), browser notifications banner (in-tab
  Notification API, no Service Worker).
- Capture management: per-row multi-select (select-all toggle),
  export selected or all captures as JSON, delete selected, and
  clear-all (which also frees the 1,000-capture cap on the same URL).
- Geist Sans / Geist Mono / Material Symbols Outlined via
  Google Fonts in `index.html`.
- Dev proxy: `/api/*` and `/i/<token>` (capture) forwarded to
  Fastify on :3000; `/c/:id` (share-link read-only view) served
  as a separate SPA route.
- `docker compose up` brings up the full stack (mongo + api +
  web) with healthchecks and a self-signed SSE-friendly nginx
  reverse proxy in front of the web bundle.

## What remains (open-ended polish, not feature gaps)

### Concrete next steps (suggested priority)

1. **Frontend tests** (Vitest + jsdom) — only `lib/diff.spec.js`
   in `apps/web`; the ~11 inspector components are unverified.
   Roughly one session: install vitest+jsdom+RTL, write 2-3 smoke
   tests per component.
2. **NL parser v2** — current heuristic regex-on-body returns 0
   matches for "stripe events" because the Stripe fixture body
   doesn't contain the word "stripe". Route provider mentions
   to field-shape fingerprints (same logic that powers #8
   `explain_event`) so "stripe events" matches Stripe bodies
   even when the body text doesn't contain the word.
3. **Domain** — buy `peekhook.dev` on Porkbun ($1.11/yr) and cut
   DNS over from the interim `peekhook.0311b.com`.
4. **Deploy** — a hosted instance already runs at
   `peekhook.0311b.com`; finish wiring the reproducible image
   (fly.io API + Cloudflare Pages web) and repoint DNS to
   `peekhook.dev`.
5. **Open questions** — three architectural decisions pending
   answer (MCP auth shape, fixture buttons on landing, self-host
   shape). See "Open questions" section below.

### Security limits (reception + sending, v1.1)

The reception + business + sending limits shipped in v1.1.
16 issues captured across the capture (`/i/:token`) and reply
surfaces, ordered by asymmetric-risk first. All shipped
end-to-end with tests; 319 / 319 backend tests passing.

**Reception — `/i/:token`**

1. **Inspector render-path audit** *(small)* ✓ — stored XSS
   via captured body / header / filename. React escapes by
   default; the audit confirmed 0 `dangerouslySetInnerHTML`,
   0 JSON-into-`<script>` injections, 0 unsanitized
   `href`/`src`/`style` interpolations. Defense-in-depth:
   `KVTable.jsx:10-11` and `SharedCaptureView.jsx:104-122`
   render header keys/values via `{k}` / `{String(v)}`.
2. **Body size cap (1 MB)** ✓ — `bodyLimit: 1_048_576` on
   the capture route. 413 on overflow.
3. **Rate limit per token (60 / min)** ✓ — sliding window
   persisted on `SandboxInbox.rateWindow`; atomic
   `findOneAndUpdate` in `MongoInboxRepository.tryConsumeCaptureSlot`.
   429 + `Retry-After` on overflow.
4. **Gzip bomb defense** ✓ — `preParsing` zlib inflate hook
   in `ingestRoute.js`; the 1 MB cap is enforced on the
   decompressed stream, not just the wire.
5. **Header sanitization on storage** ✓ — `headerSanitizer.js`
   strips NUL, C0 controls (except TAB), DEL, and the
   RTL-override range (`U+202A`-`U+202E`, `U+2066`-`U+2069`).
6. **Trust proxy / IP spoofing** ✓ — `config.trustProxy`
   flag (defaults to `true` in prod, `false` in dev).
   `req.ip` only honors `X-Forwarded-For` when the flag is
   set; otherwise the socket peer is ground truth.
7. **IDOR check on read endpoints** ✓ — every read endpoint
   that takes a request id (`/api/inboxes/:token/requests/:id`,
   `/api/requests/:id`) is scoped to `{ _id, inboxToken }`.
   The share-link endpoint now requires `?token=<inboxToken>`.
8. **Per-inbox request cap: 1,000** ✓ — `captureCount`
   counter on the aggregate; atomic check
   `captureCount < 1000` in the same `findOneAndUpdate` as
   the rate limit. 429 + `Retry-After` on overflow; existing
   captures stay readable. Mint a new inbox to continue.

**Sending — mock reply, replay, share, MCP**

1. **`node:vm` → worker thread** ✓ — `scriptWorker.js` +
   `workerThreadRunner.js`. `resourceLimits.maxOldGenerationSizeMb: 32`,
   200 ms timeout via `worker.terminate()` from the parent,
   no network, no `Buffer`, no `setTimeout`, no `require`,
   no `fetch`. `nodeVmRunner.js` deleted. All sandbox-escape
   attempts (prototype traversal, `process.binding`, infinite
   loops) verified contained.
2. **CRLF in mock `content-type`** ✓ — allowlist
   (`text/plain`, `application/json`, `application/xml`,
   `text/html`) enforced at config time; CR/LF rejected with
   400 before the config is persisted.
3. **Mock body cap: 64 KB** ✓ — `MOCK_BODY_MAX_BYTES` enforced
   in `validateResponseConfig`; `mockBodySize` field on the
   aggregate persisted alongside the response config.
4. **Share link id entropy** ✓ — `crypto.randomBytes(16)`
   32-hex-char id generated at share time, stored on the
   request as `shareId`. Sparse unique index `{ inboxToken,
   shareId }`. New endpoint `POST
   /api/inboxes/:token/requests/:id/share` returns
   `{ shareUrl, shareId }`. Old ObjectId URLs return 404.
5. **SSE connection cap per token** ✓ — 5 concurrent
   connections per inbox token, 5 min idle timeout, clean
   close (200 + empty body — see `apiRoute.js:185-198` for
   why 200 over 204).
6. **MCP rate limit (10 / min per token)** ✓ — sliding
   window in `InMemoryMcpRateLimiter`, 429 + `Retry-After`
   + JSON-RPC `-32002` on overflow. Enforced *after* auth,
   *before* tool dispatch.
7. **MCP audit log** ✓ — `mcp_audit_log` collection, one
   document per authenticated `tools/call`. Plaintext
   token never enters the pipeline; only the SHA-256
   `tokenHash` is stored. Best-effort (write failure logs
   to stderr, the call still succeeds). 7-day TTL on
   `timestamp` declared in `db.js`.
8. **MCP prompt-injection wrappers** ✓ — `SafeResponse.js`
   projects `search_events` and `diff_events` responses
   through `safeEvent` (extracts id/method/path/contentType/
   size/ip/createdAt; caps top-level body fields at 1 KB
   with `truncated: true`). `get_event` gains
   `includeBody: false` default; even when opted in, the
   body is wrapped in `userControlled: true` and capped at
   1 KB. `list_events` and `explain_event` left as-is
   (summaries only).
9. **Replay rate limit per inbox token** ✓ — 1 / minute
   per inbox token (reverted from the v1.1 per-(token, IP)
   variant after product review). Atomic `tryConsume` in
   `InMemoryReplayRateLimiter`.

### Won't build until demand

- **Vanity URLs** (`my-shop.peekhook.dev`). Free → token URL,
  paid → slug. Wait for a paying customer.
- **Slack / Discord / Teams / email notifiers**. Browser
  notifications + MCP cover the same developer audience.
- **Embed iframe**. The only embed that matters is the landing
  page demo; no public widget API needed.
- **Browser extension** (capture browser-side fetch). Postman
  and Insomnia proved low adoption. Not our fight.
- **Email inbound** (`xxx@peekhook.dev` → captured event). Clear
  demand path; cheap to add when asked.

> **Reversed:** *Tunnel-style capture-and-forward* used to live here.
> It shipped in v1.2 as the `peekgrok --to` sniffer (transparent
> reverse proxy that captures + forwards every request/response),
> and v1.3 added replay-to-forward on top. No longer a "won't build".

## Candidate features (the 14)

Each entry has the rationale and an effort tag (small = days,
medium = weeks, large = sprint+). All 14 are now ✓ shipped;
the rationale + effort remain as historical record.

### Parity with webhook.site (must ship eventually)

1. **JS scripting in mock reply** *(small → medium)* ✓ shipped
   (backend + script editor textarea with 200ms-timeout + 8KB
   cap badge). Toggle a script that mutates the response from
   request context. `node:vm` behind a feature flag, strict
   mode, no `require`, no outbound `fetch`.
2. **Browser notifications** *(small)* ✓ shipped (useBrowserNotify
   hook + NotifyPermissionBanner sidebar component, Notification
   API on capture when tab is hidden, no backend, no Service
   Worker). Notification API + permission prompt on the first
   capture received while the tab is in background.
3. **Search + filter in inbox** *(small → medium)* ✓ shipped
   (SearchBar in sidebar with debounced regex input + field
   selector, request list re-labels to 'search results' when
   active, returns to live mode on clear). Regex on path, header
   name, header value, body substring.

### Comparator wedge (differentiation)

4. **Two-event diff side-by-side** *(medium)* ✓ shipped (multi-select
   checkbox on RequestRow + side-by-side A vs B render via LCS
   in lib/diff.js, line-level body diff + header-level diff).
5. **Schema-history sparkline** *(medium)* ✓ shipped (sidebar
   panel polls /schema-history every 5s, ranks top-level fields
   by occurrence, mini-sparkline per field). Per field,
   sparkline of presence + type over time.
6. **Diff across time range** *(small)* ✓ shipped (data layer
   accessible via GET /api/inboxes/:token/schema-history; the
   firstSeenAt / lastSeenAt fields per schema-history record
   carry enough state for any future time-range picker UI to
   build on top).

### AI / MCP wedge (moat)

7. **MCP server** *(medium → large)* ✓ shipped (backend exposes a
    single Streamable HTTP endpoint at `POST /mcp` + McpTokenCard
    sidebar component with copy + ready-to-paste client config
    snippets for Claude Code / Cursor / curl). Streamable HTTP
    transport per MCP spec (JSON-RPC 2.0 over HTTP). Auth via
    `Authorization: Bearer <mcp_token>` (hashed SHA-256 lookup, inbox
    resolution per request, no per-tool credentials). Tools:
    `list_events`, `get_event`, `search_events`, `diff_events`,
    `explain_event`. Distribution is a single URL — paste into any MCP
    client, no `npm install`, no Docker, no local process. Closes the
    agent-in-the-loop debugging flow in Claude Code / Cursor /
    Cline.
8. **`explain_event`** *(small → medium)* ✓ shipped (lives inside
   the MCP server as `explain_event` tool — `peekhook.explain_event
   ({inbox_token, event_id}) → {provider, summary, fields}`).
   Provider fingerprint detection (Stripe / GitHub / Linear
   shape match) plus a one-line human-readable summary.
9. **Schema-drift callouts** *(small)* ✓ shipped (chip on
   DetailPanel showing `+N new since capture` with tooltip
   listing the specific new paths; walks the request's body via
   the same path rules as PayloadSignature).

### Polish + accretion

10. **Natural-language search** *(medium)* ✓ shipped (heuristic
    parser in lib/nlParse.js recognizes provider + amount +
    field hints; SearchBar shows examples row + 'translated to'
    hint). Translate e.g. "show me stripe events over $50" into
    a Mongo regex + field selection.
11. **Pre-loaded fixture library** *(small)* ✓ shipped
    (EmptyState now renders one chip per fixture; click posts to
    the existing /api/inboxes/:token/fixtures/:id endpoint).
    Stripe / GitHub / Linear / generic sample payloads with
    "send now" buttons.
12. **Replay-with-mutations** *(small → medium)* ✓ shipped
    (replay button on DetailPanel header; 3s replayed-status
    badge with expandable body details; rate-limit shows
    "rate-limited, retry in 60s"). POST /replay mockOnly-mode
    only, 1/min rate limit per inbox token, X-Peek-Replay header
    echoed in response DTO.
13. **Share link (read-only)** *(small)* ✓ shipped (GET
    /api/requests/:id public endpoint + /c/:id SPA route +
    SharedCaptureView read-only chrome + share button on
    DetailPanel that copies `${origin}/c/{id}` to clipboard).
14. **Self-host docker-compose** *(medium)* ✓ shipped (`docker
    compose up` brings up mongo + api + web with healthchecks
    and SSE-friendly nginx).

## Open questions

1. **MCP auth**: inbox-scoped tokens (public-by-default) or
   workspace-scoped (requires account)? Or both, with the
   inbox token exposing only the inbox that minted it?
2. **Fixtures on landing page**: does the "send a real Stripe
   webhook now" button belong on `/` or only inside the
   Inspector? Landing-page presence drives demo quality.
3. **Self-host shape**: ship `docker-compose.yml` with Mongo
   as a service, or document `mongod` install + instructions
   for bringing your own? First is friendlier; second is
   more honest about the data layer.

## Update log

- **v1.3**: usability batch aimed at the daily debug loop —
  turns peekhook from "look at webhooks" into "iterate on them."
  Seven features, all backend + frontend + tests:
  1. **Replay to forward target** — `POST /replay` gained
     `mode: 'forward'`, re-sending a captured event to the inbox's
     already-configured `forwardTo` (reuses `ForwardRequest`; safe
     without inbox-claim because the target is the pre-validated,
     loop-checked URL that already takes live traffic, not an
     arbitrary caller-supplied one).
  2. **Edit-and-replay** — `mutations: { method, path, headers, body }`
     overlaid on the capture before mock/forward, surfaced as an
     "edit & replay" panel in the DetailPanel.
  3. **Mock-reply delay** — `responseConfig.delayMs` (0–30s) holds
     the reply to simulate a slow / timing-out upstream. Honored by
     both the hosted ingest and the peekgrok sniffer.
  4. **GET capture** — `/i/:token` now captures non-browser GET
     (OAuth callbacks, verification pings); a browser navigation
     (`Accept: text/html`) still 405s. Local SPA mode unaffected
     (the GET route isn't registered there).
  5. **Export** — `GET /api/inboxes/:token/export` returns captures
     as a downloadable JSON document; `?ids=` exports only a
     selection.
  6. **Clear / delete** — `DELETE /api/inboxes/:token/requests` with
     no body clears the whole inbox and resets the 1,000-cap; with
     `{ ids }` it deletes just those (new repo methods on Mongo +
     SQLite). The inspector row checkbox became a general multi-select
     (diff now = "select exactly 2"), with a select-all toggle and a
     selection action bar (export / delete selected).
  7. **Binary-safe sniffer + noise filter** — `ForwardRequest`
     reads binary upstream responses as bytes (not mangled UTF-8)
     and omits the body on GET/HEAD; `peekgrok --ignore <prefixes>`
     forwards but skips capturing health/asset noise.
  Plus **shareable links from peekgrok**: the share route builds
  `/c/<id>` against a configured public base (mutable `shareBase`
  holder on the app), which the CLI sets to the ngrok URL once the
  tunnel connects — no more `localhost` links. In sniffer mode the
  proxy reserves `/c`, `/assets`, `/api/requests` and relays them to
  the local inspector so the public link resolves. Hosted target
  leaves `shareBase` null and uses the request Host header.
  340 / 340 backend tests across 39 files (Node/vitest) + the
  bun:sqlite / proxy integration tests (`apps/api/tests`,
  `apps/cli/tests`). NL-parser-v2 and the schema sparkline remain
  the next polish items.
- **v1.2**: local-first `peekgrok` CLI. New `apps/cli` package
  (`@peekhook/cli`, Bun runtime) ships a single self-contained
  binary that runs the whole stack — capture, inspector UI, SSE,
  MCP — on the user's machine over `bun:sqlite`, no Mongo, no
  signup, data in `~/.peekhook/peekgrok.db`. `peekgrok listen
  <port>` opens an optional ngrok tunnel with a random inbox
  token baked into the URL (`--no-tunnel` for localhost-only).
  Enabled by a dual-target refactor: `apps/api/src/app.js` now
  exposes a `buildApp(deps, options)` factory; `src/index.js`
  wires the `Mongo*` adapters (hosted, unchanged) and the new
  `src/cli.js` wires `Sqlite*` adapters. Every persistence port
  gained a `Sqlite*` sibling; domain/app layers untouched.
  Binary renamed `peektunnel` → `peekgrok`.
- **v1.1**: security limits shipped end-to-end across the
  reception (body cap 1 MB, rate limit 60/min, gzip-bomb
  defense, header sanitization, IDOR audit, trust-proxy),
  business (per-inbox 1k request cap), and sending
  (`node:vm` → worker thread sandbox, mock reply 64 KB cap
  + content-type allowlist + CRLF reject, share link random
  id, SSE 5-conn cap, replay per-token 1/min, MCP rate
  limit 10/min + audit log 7-day TTL + prompt-injection
  wrappers) surfaces. 16 issues captured in the "Security
  limits" section above, all shipped. 5-commit landing on
  `main`. 319 / 319 backend tests passing across 37 files.
  Frontend render-path audit clean (0 XSS vectors);
  Vitest not yet installed in `apps/web` (separate polish).
- **v1.0**: 16 / 16 features shipped. Original plan complete.
  Pushed to github.com/ricardomoratomateos/peekhook. Last two
  features (#10 NL search, #13 share link) landed in one
  batch. NL parser is regex-on-body; v2 routing through
  field-shape fingerprints is the next polish item.
- **v0.9**: shipped all six remaining inspector surfaces in
  one batch (#2 notifications, #3 search, #4 diff, #9 drift,
  #11 fixtures, #12 replay). All wired to backend endpoints
  that already shipped. No new backend. The 14 candidate
  features were at 14 shipped / 0 net-new pending.
- **v0.8**: ROADMAP reorganized. Added explicit "Remaining to
  ship" section listing the six outstanding items (4
  backend-only-needing-frontend, 2 net-new) before the
  numbered candidate list, so a 30-second skim of the doc
  tells you what's pending.
- **v0.7**: added `POST /api/inboxes/:token/regenerate-mcp`
  endpoint (rotates the inbox's MCP hash + returns plaintext).
  McpTokenCard now always renders (un-gated on token presence)
  with a "mint a fresh token" CTA when opened by URL.
- **v0.6**: shipped frontend for the four previously
  backend-only features. McpTokenCard surfaces mcp_token in the
  sidebar. SchemaSparkline sidebar panel polls /schema-history
  every 5s. ResponseConfigPanel got a sibling "use js script"
  toggle paired with a textarea + 8192-char counter. Landing
  now persists mcpToken in localStorage + navigate state.
- **v0.5**: shipped #3 server-side regex search, #11 fixture
  library (4 providers + send endpoint), #12 mock-replay-with-
  rate-limit. All three landed clean in isolation because each
  agent owned its own features/<x>/ folder. Orchestrator
  wiring lives in apps/api/src/index.js. 136 / 136 tests in
  apps/api.
- **v0.4**: shipped #14 self-host docker-compose (one-command
  bring-up of mongo + api + web with healthchecks and
  SPA-aware nginx; verified end-to-end with a scripted POST
  round-trip through the public-nginx → API chain).
- **v0.3**: shipped #1 (JS scripting), #5 (schema-history data
  layer), #6 (schema-history query surface), #7 (MCP server,
  5 tools over stdio; later flipped to Streamable HTTP transport
  with a single `POST /mcp` Fastify route and Bearer-token auth)
  via 3 parallel agents + serial merges.
  58/58 tests green in apps/api after all 3 merges.
- **v0.2**: dropped #4 capture-endpoint-with-forward (the
  "tunnel-sniffer" idea escalated to "tunnel-as-a-service"
  territory and we don't have demand yet) and #16 email inbound
  (also deferred to Won't build until demand). Renumbered
  remaining features 1-14. Open question 4 retired.
- **v0.1 (initial)**: locked-in stack, what ships today, 16
  candidate features grouped by wedge, won't-build list, open
  questions.
