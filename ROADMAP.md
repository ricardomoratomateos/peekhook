# Roadmap

PeekHook is a free, anonymous webhook inspector. Public,
ephemeral, zero signup. The bet: developers want to look at
webhooks fast without configuring anything, and the current
incumbent (webhook.site) hasn't shipped serious new features
in years.

## Status (v1.0)

- **16 / 16 features shipped** end-to-end (14 candidate + 2 net-new).
- **Repo published**: `github.com/ricardomoratomateos/peekhook`
- **Branch**: `main` (38 commits pushed, single default branch).
- **Backend tests**: 136 / 136 passing (Vitest + mongodb-memory-server).
- **Frontend tests**: 0 (Vitest+jsdom not yet installed in `apps/web`).
- **Local stack**: Mongo in Docker (`peekhook-mongo`), API on
  `:3000`, Vite dev on `:5173`. The same stack runs under
  `docker compose up` for self-host.

The 16-item feature plan is complete. Future work is open-ended
polish, not feature delivery.

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

- **Backend**: Fastify + MongoDB, no breaking changes planned.
- **Frontend**: Vite + React 18 + react-router, no SSR.
- **Storage**: Mongo TTL 7 days, single database.
- **Auth**: none, ever, unless pull justifies it.
- **Hosting (planned)**: API on fly.io free tier, web on
  Cloudflare Pages. Not yet wired.
- **Domain (planned)**: `peekhook.dev` via Porkbun, $1.11/yr.
  Not yet bought.
- **No Slack / Discord / Teams / email notifiers in MVP**.
  Browser notifications + MCP reach the same audience without
  wiring four more integrations.

## What ships today (user-visible surface)

- Inbox create + auto-delete after 7 days (TTL index).
- Capture POST/PUT/PATCH/DELETE at `/i/:token`. GET returns 405
  (reserved for the Inspector SPA).
- Live SSE stream of new captures into the request list.
- Inspector UI: method, headers, query, body, IP, size, content-type
  for each captured request. Method chip + path + timestamp.
- Static mock reply (status + content-type + body) configurable
  per inbox.
- "Copy as curl" button on every capture + the empty state.
- Inspector features: search input (regex + field selector +
  natural-language examples), schema sparkline sidebar panel
  (5s poll), MCP token card (with copy + curl-style usage
  snippet + regenerate button), two-event diff side-by-side
  (LCS body + header diff), replay button (mock-reply-only,
  1/min rate limit), schema-drift callout chip on DetailPanel,
  fixture buttons in EmptyState (Stripe / GitHub / Linear /
  generic), browser notifications banner (in-tab Notification
  API, no Service Worker).
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

1. **Frontend tests** (Vitest + jsdom) — 0 tests in `apps/web`.
   The 11 inspector components are unverified. Roughly one
   session: install vitest+jsdom+RTL, write 2-3 smoke tests per
   component.
2. **NL parser v2** — current heuristic regex-on-body returns 0
   matches for "stripe events" because the Stripe fixture body
   doesn't contain the word "stripe". Route provider mentions
   to field-shape fingerprints (same logic that powers #8
   `explain_event`) so "stripe events" matches Stripe bodies
   even when the body text doesn't contain the word.
3. **Domain** — buy `peekhook.dev` on Porkbun ($1.11/yr).
4. **Deploy** — `docker compose build` already works locally;
   wire the same image to fly.io (API) + Cloudflare Pages
   (web), point DNS at `peekhook.dev`. One session.
5. **Open questions** — three architectural decisions pending
   answer (MCP auth shape, fixture buttons on landing, self-host
   shape). See "Open questions" section below.

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
- **Tunnel-style capture-and-forward** (`/i/<token>` that also
  POSTs to a configured destination without an SSH agent).
  Useful but adds state for a feature nobody has asked for.

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

7. **MCP server** *(medium → large)* ✓ shipped (backend 5 stdio
   tools + McpTokenCard sidebar component with copy + curl-style
   usage snippet). stdio transport. Auth via inbox-scoped API
   key. Tools: `list_events`, `get_event`, `search_events`,
   `diff_events`, `explain_event`, `create_endpoint`. Closes the
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
  5 tools over stdio) via 3 parallel agents + serial merges.
  58/58 tests green in apps/api after all 3 merges.
- **v0.2**: dropped #4 capture-endpoint-with-forward (the
  "tunnel-sniffer" idea escalated to "tunnel-as-a-service"
  territory and we don't have demand yet) and #16 email inbound
  (also deferred to Won't build until demand). Renumbered
  remaining features 1-14. Open question 4 retired.
- **v0.1 (initial)**: locked-in stack, what ships today, 16
  candidate features grouped by wedge, won't-build list, open
  questions.
