# Roadmap

PeekHook is a free, anonymous webhook inspector. Public,
ephemeral, zero signup. The bet: developers want to look at
webhooks fast without configuring anything, and the current
incumbent (webhook.site) hasn't shipped serious new features
in years.

## Direction

Stay tiny. Stay free. Don't add auth unless users ask for it
twice. The differentiated wedges are:

1. **Comparator**: diff two captures side-by-side,
   schema-drift over time, "find events where X changed A→B".
2. **AI-native surfacing**: MCP server, `explain_event`,
   provider fingerprint detection, schema-drift callouts.

Reject the SaaS feature factory. Every new feature has to earn
its weight against the curl-then-look-at-the-Inspector flow.

## Locked-in stack decisions

- **Backend**: Fastify + MongoDB, no breaking changes planned
- **Frontend**: Vite + React 18 + react-router, no SSR
- **Storage**: Mongo TTL 7 days, single database
- **Auth**: none, ever, unless pull justifies it
- **Hosting**: API on fly.io free tier, web on Cloudflare Pages
- **Domain**: `peekhook.dev` (Porkbun, $1.11 first year)
- **No Slack / Discord / Teams / email notifiers in MVP**. Browser notifications + MCP reach the same audience.

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

## P0: parity with webhook.site (must ship)

- **JS scripting in mock reply**. Toggle a script that mutates
  the response based on the request. `node:vm` behind a flag,
  strict mode, no `require`, no `fetch` outside the inbox.
  This is the signature feature webhook.site has. Without
  it we are not a real alternative.
- **Browser notifications**. Notification API + permission
  prompt on first capture received while tab is in background.
  Cheap (vite-plugin-pwa or a small service worker), high UX
  signal, no third-party service.
- **Search + filter in inbox**. Regex on path, header name,
  header value, body substring. Client-side up to 1000 events,
  server-side when Mongo query cost justifies it.

## P1: differentiators

- **MCP server**. stdio + HTTP. Auth via inbox-scoped API key
  by default, workspace-scoped once accounts exist. Tools:
  `list_events`, `get_event`, `search_events`, `diff_events`,
  `explain_event`, `create_endpoint`. Closes the
  agent-in-the-loop debugging flow when the user is in Claude
  Code / Cursor / Cline.
- **Diff side-by-side**. Pick two captures, see headers +
  body diffed visually (lines highlighted per byte/char change).
  Webhook.site has nothing comparable.
- **Schema-history sparkline**. Per field, sparkline of
  presence + type over time. "Field `metadata.refund_reason`
  appeared on 3 of the last 5 events."
- **Replay-with-mutations**. Default against the inbox's own
  mock reply endpoint only. External URL replay requires
  claim + 1/min rate limit + `X-Peek-Replay: 1` injected
  header + mandatory UI warning modal that names the risk in
  plain language. No path that lets an anonymous inbox
  re-send a modified payload to the open internet.

## P2: accretion

- **Pre-loaded fixture library**. Stripe / GitHub / Linear
  sample payloads with "send now" buttons. Reduces friction
  on the landing page demo and in the docs.
- **Capture endpoint with optional forward**. `/i/<token>`
  captures AND optionally POSTs to a configured destination.
  Closer to requestbin's "forward to localhost" idea but
  without an SSH agent on the user's box. Pure HTTP capture
  in the cloud.
- **Self-host docker-compose**. One container Mongo + API,
  web stays on Pages. For hobbyists and enterprise with
  data-residency requirements.
- **Share link**. Read-only URL for a single capture, no SSE,
  no inbox navigation. Useful in PR comments and chat.

## Won't build until demand

- **Vanity URLs** (`my-shop.peekhook.dev`). Free gets the
  token URL, paid gets the slug. Won't ship until a paying
  customer asks.
- **Email inbound** (`xxx@peekhook.dev` → captured event).
  Worth doing once a user explicitly asks. Easy to defer.
- **Slack / Discord / Teams / email notifiers**. Browser
  notifications + MCP reach the same dev audience without
  wiring four more integrations.
- **Embed iframe**. The only embed that matters is the
  landing page demo; we don't need a public widget API.
- **Browser extension** (capture browser-side fetch). Postman
  and Insomnia both tried; adoption was poor. Not our fight.

## Deferred from the parent (webhookguard) "Guard" wedge

These are working code on the parent repo and are tempting to
carry over, but they belong to a different product pitch
("trusted SaaS with payments, plans, workspaces, audit log").
Move to ROADMAP-guard.md if real user pull demands:

- HMAC signature verification for Stripe / GitHub / Shopify /
  custom providers
- Timestamp + nonce tolerance window on HMAC
- PII redaction in body (JSONPath + regex rules)
- Schema validation gate (drop requests whose payload fails
  the registered JSON Schema, alert on drift)
- Anomaly detection (rule-based thresholds, never ML)
- Audit log export (CSV / JSON)

## Open questions

1. **MCP auth**: inbox-scoped tokens (public-by-default) or
   workspace-scoped (requires account)? Or both, with the
   inbox token exposing only the inbox that minted it?
2. **Fixtures on landing page**: does the "send a real
   Stripe webhook now" button belong on `/` or only inside
   the Inspector? Landing page presence drives demo quality.
3. **Self-host shape**: ship `docker-compose.yml` with Mongo
   as a service, or document `mongod` install + instructions
   for bringing your own? The first is friendlier, the
   second is more honest about the data layer.
4. **Email inbound inbox**: special `email-capture` inbox
   per email address, or route to an existing inbox?

Update this file when priorities shift. Mention in the
commit message which P-level the change touches.
