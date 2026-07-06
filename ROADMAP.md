# Roadmap

PeekHook is a free, anonymous webhook inspector. Public,
ephemeral, zero signup. The bet: developers want to look at
webhooks fast without configuring anything, and the current
incumbent (webhook.site) hasn't shipped serious new features
in years.

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

- **Backend**: Fastify + MongoDB, no breaking changes planned
- **Frontend**: Vite + React 18 + react-router, no SSR
- **Storage**: Mongo TTL 7 days, single database
- **Auth**: none, ever, unless pull justifies it
- **Hosting**: API on fly.io free tier, web on Cloudflare Pages
- **Domain**: `peekhook.dev` (Porkbun, $1.11 first year)
- **No Slack / Discord / Teams / email notifiers in MVP**.
  Browser notifications + MCP reach the same audience without
  wiring four more integrations.

## What ships today

- Inbox create + auto-delete after 7 days (TTL index)
- Capture POST/PUT/PATCH/DELETE at `/i/:token`
- Live SSE stream of new captures
- Inspector UI: method, headers, query, body, IP, size, content-type
- Static mock reply (status + content-type + body)
- "Copy as curl" button on every capture + on the empty state
- Geist Sans / Geist Mono / Material Symbols Outlined via Google Fonts
- 405 on GET `/i/:token` (reserved for the Inspector UI)
- Dev proxy: `/api/*` forwarded to Fastify on :3000

## Remaining to ship

All 14 candidate features + 2 net-new features (NL search,
share link) are now ✓ shipped end-to-end. The original 16-item
plan is complete. Future work is open-ended:

### Optional polish

- NL parser v2: route provider mentions to field-shape
  fingerprints (the same logic that powers #8 explain_event)
  so "stripe events" matches Stripe bodies even when the body
  text doesn't contain the word "stripe".
- Frontend tests (Vitest + jsdom) — currently 0 tests in
  `apps/web`. The 11 inspector components are not covered.
- Deploy to fly.io + Cloudflare Pages with DNS.
- Buy `peekhook.dev` on Porkbun ($1.11/yr).

### Deferred to "won't build until demand"

- Vanity URLs (`my-shop.peekhook.dev`). Free → token URL.
- Slack / Discord / Teams / email notifiers (subsumed by MCP).
- Embed iframe.
- Browser extension (Postman / Insomnia proved low adoption).
- Email inbound (`xxx@peekhook.dev` → captured event).
- Tunnel-style capture-and-forward.

## Candidate features (the 14)

Each entry has the rationale and an effort tag (small = days,
medium = weeks, large = sprint+). Pick from this list when
starting work; reorder freely when pull demands.

### Parity with webhook.site (must ship eventually)

1. **JS scripting in mock reply** *(small → medium)* ✓ shipped (backend + script editor textarea with 200ms-timeout + 8KB cap badge). Toggle a
   script that mutates the response from request context.
   `node:vm` behind a feature flag, strict mode, no `require`,
   no outbound `fetch`. This is webhook.site's signature
   feature. Without it we are not a real alternative.
2. **Browser notifications** *(small)* ✓ shipped (useBrowserNotify hook + NotifyPermissionBanner sidebar component, Notification API on capture when tab is hidden, no backend, no Service Worker). Notification API +
   permission prompt on the first capture received while the
   tab is in background. `vite-plugin-pwa` or a small service
   worker. Cheap, high UX signal.
3. **Search + filter in inbox** *(small → medium)* ✓ shipped (SearchBar in sidebar with debounced regex input + field selector, request list re-labels to 'search results' when active, returns to live mode on clear). Regex on
   path, header name, header value, body substring. Client-side
   up to ~1000 events. Server-side when Mongo query cost
   justifies it.

### Comparator wedge (differentiation)

4. **Two-event diff side-by-side** *(medium)* ✓ shipped (multi-select checkbox on RequestRow + side-by-side A vs B render via LCS in lib/diff.js, line-level body diff + header-level diff). Pick two
   captures, see headers + body diffed visually with lines
   highlighted per byte/char change. Webhook.site has nothing
   comparable.
5. **Schema-history sparkline** *(medium)* ✓ shipped (sidebar panel polls /schema-history every 5s, ranks top-level fields by occurrence, mini-sparkline per field). Per field, sparkline
   of presence + type over time. "Field `metadata.refund_reason`
   appeared on 3 of the last 5 events." Big wedge, requires
   ingesting and aggregating schema snapshots.
6. **Diff across time range** *(small)* ✓ backend shipped (data layer accessible). Time-range picker,
   per-field "values seen" list, jump to first event where a
   value changed. Compounds with #5.

### AI / MCP wedge (moat)

7. **MCP server** *(medium → large)* ✓ shipped (backend 5 stdio tools + McpTokenCard sidebar component with copy + curl-style usage snippet). stdio + HTTP transport.
   Auth via inbox-scoped API key by default. Tools:
   `list_events`, `get_event`, `search_events`, `diff_events`,
   `explain_event`, `create_endpoint`. Closes the
   agent-in-the-loop debugging flow in Claude Code / Cursor /
   Cline.
8. **`explain_event`** *(small → medium)* ✓ shipped (lives inside the MCP server as `explain_event` tool — `peekhook.explain_event({inbox_token, event_id}) → {provider, summary, fields}`). Provider fingerprint
   detection (Stripe / GitHub / Linear shape match) plus a
   one-line human-readable summary. Used both via MCP and as
   a UI panel inside the Inspector.
9. **Schema-drift callouts** *(small)* ✓ shipped (chip on DetailPanel showing `+N new since capture` with tooltip listing the specific new paths; walks the request's body via the same path rules as PayloadSignature). "3 of the last 5
   events have a new field X" surfaced as a badge on the
   request detail panel and as an MCP resource.
10. **Natural-language search** *(medium)* ✓ shipped (heuristic parser in lib/nlParse.js recognizes provider + amount + field hints; SearchBar shows examples row + 'translated to' hint). "show me stripe
    events with amount > 100" parsed into a Mongo query, with
    confidence-sourced prompts when ambiguity is high. UI bar
    + MCP tool.

### Polish + accretion

11. **Pre-loaded fixture library** *(small)* ✓ shipped (EmptyState now renders one chip per fixture; click posts to the existing /api/inboxes/:token/fixtures/:id endpoint). Stripe / GitHub /
    Linear sample payloads with "send now" buttons. Reduces
    friction on the landing page demo and in the docs.
12. **Replay-with-mutations** *(small → medium)* ✓ shipped (replay button on DetailPanel header; 3s replayed-status badge with expandable body details; rate-limit shows "rate-limited, retry in 60s"). POST /replay, mockOnly-mode only, 1/min rate limit per inbox token, X-Peek-Replay header echoed in response DTO). Default
    against the inbox's own mock reply endpoint only. External
    URL replay gated by claim + 1/min rate limit + injected
    `X-Peek-Replay: 1` header + mandatory UI warning modal
    naming the risk in plain language. No code path that lets
    an anonymous inbox re-send a modified payload to the
    open internet.
13. **Share link (read-only)** *(small)* ✓ shipped (GET /api/requests/:id public endpoint + /c/:id SPA route + SharedCaptureView read-only chrome + share button on DetailPanel that copies `${origin}/c/{id}` to clipboard). Public URL for a
    single capture, no SSE, no inbox navigation. Useful in
    PR comments, Slack threads, bug reports.
14. **Self-host docker-compose** *(medium)* ✓ shipped (`docker compose up` brings up mongo + api + web with healthchecks and SSE-friendly nginx). One container
    Mongo + API, web stays on Pages. For hobbyists and
    enterprise with data-residency requirements.

## Won't build until demand

- **Vanity URLs** (`my-shop.peekhook.dev`). Free gets the
  token URL, paid gets a slug. Won't ship until a paying
  customer asks.
- **Slack / Discord / Teams / email notifiers**. Browser
  notifications + MCP reach the same dev audience.
- **Embed iframe**. The only embed that matters is the
  landing page demo; we don't need a public widget API.
- **Browser extension** (capture browser-side fetch). Postman
  and Insomnia both tried; adoption was poor. Not our fight.
- **Email inbound** (`xxx@peekhook.dev` → captured event).
  Demand is clear once a user explicitly asks. Cheap to add
  when the day comes.
- v0.5: shipped #3 server-side regex search,
  #11 fixture library (4 providers + send endpoint), #12
  mock-replay-with-rate-limit. All three landed clean in
  isolation because each agent owned its own features/<x>/
  folder. Orchestrator wiring lives in apps/api/src/index.js.
  Smoke count: docker stack + 3 new endpoints + limit-rate +
  schema-history validation. 136 / 136 tests in apps/api.
- v0.6: shipped frontend for the four previously backend-only
  features. McpTokenCard surfaces mcp_token in the sidebar with
  copy + a MCP quick-start snippet (no agent-side wiring yet;
  commands documented inline). SchemaSparkline sidebar panel
  polls /schema-history every 5s and renders top-level fields
  ranked by occurrence. ResponseConfigPanel now has a sibling
  "use js script" toggle paired with a textarea + 8192-char
  counter (red on overflow, save disabled). Landing now persists
  mcpToken in localStorage + navigate state so the inspector
  finds it on load.
- v0.7: added `POST /api/inboxes/:token/regenerate-mcp`
  endpoint (rotates the inbox's MCP hash + returns plaintext).
  McpTokenCard now always renders (un-gated on token presence)
  with a "mint a fresh token" CTA when opened by URL. The
  scroll-button count of "things to look at" got noisy for
  direct-URL visitors; the new path lets them recover without
  re-creating the inbox.
- v0.8: ROADMAP reorganized. Added explicit "Remaining to
  ship" section listing the six outstanding items (4
  backend-only-needing-frontend, 2 net-new) before the
  numbered candidate list, so a 30-second skim of the doc
  tells you what's left.
- v0.4: shipped #14 self-host docker-compose (one-command
  bring-up of mongo + api + web with healthchecks and SPA-aware
  nginx; verified end-to-end with a scripted POST round-trip
  through the public-nginx → API chain).
- **Tunnel-style capture-and-forward** (`/i/<token>` that
  also POSTs to a configured destination without an SSH
  agent on the user's box). Useful but adds state for a
  feature nobody has yet asked for.

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

- v0.1 (initial): locked-in stack, what ships today, 16
  candidate features grouped by wedge, won't-build list, open
  questions. Update this log when priorities shift or features
  land.
- v0.2: dropped #4 capture-endpoint-with-forward (the
  "tunnel-sniffer" idea escalated to "tunnel-as-a-service"
  territory and we don't have demand yet) and #16 email inbound
  (also deferred to Won't build until demand). Renumbered
  remaining features 1-14. Polish section now balanced at
  four items. Open question 4 retired (email-inbound shape
  no longer in play).
- v0.3: shipped #1 (JS scripting), #5 (schema-history data
  layer), #6 (schema-history query surface), #7 (MCP server,
  5 tools over stdio) via 3 parallel agents + serial merges.
  58/58 tests green in apps/api after all 3 merges (plus 3
  CaptureRequest regressions). Frontend UI for JS scripting
  editor and schema sparkline still pending. Open question
  about MCP auth answered for now: inbox-scoped token, with
  plaintext returned only at create.
