# Inspector 2026 — Layout Redesign

**Owner:** design
**Status:** superseded — see [DESIGN.md](../../../DESIGN.md)
**Target:** `apps/web/src/features/inspector/InspectorView.jsx`

> **Note:** This document describes the v2.0 design (icon rail + 300 px
> workspace sidebar + detail pane). The shipped version evolved further:
> the workspace sidebar was removed entirely and each tab is now a full
> page. See the root [DESIGN.md](../../../DESIGN.md) for the current system.
> The historical analysis in §1–§3 is still useful context for *why*
> layout iterations matter; the component-relocation plan in §5 was not
> what shipped.

---

## 1. Problem statement

The Inspector view stacks **nine** sub-components vertically inside a single
272 px-wide left sidebar:

1. `logo`
2. `ctxRow` (inbox name + LiveBadge)
3. `urlCard` (inbox URL + copy button)
4. `copyTestBtn` (copy a curl test request)
5. `ResponseConfigPanel` (mock-reply editor)
6. `NotifyPermissionBanner` (browser notifications prompt)
7. `SearchBar` (regex + NL search)
8. `McpTokenCard` (MCP token + copy)
9. `SchemaSparkline` (mini sparkline)
10. `listHead` + `listRows` (the captured request list)

At 1080 p with the inspector at the default 50 %-split width, the right detail
pane gets ~540 px and the sidebar stays at 272 px. The request list is the
*last* element in a vertical flex column — by the time the eye reaches it, the
user has already scrolled past ~480–560 px of configuration chrome. **The
inbox owner fires a webhook, looks at the screen, and sees nothing happening
because their first request landed behind the fold.** The whole value
proposition (live capture, inspect, replay) is hidden under clutter.

Constraints:

- The visual language is locked (dark monochrome canvas, electric-lime `#c8ff00`
  accent, Geist Sans / Geist Mono — `apps/web/src/features/inspector/lib/tokens.js`).
- React 18, react-router 6, Vite, inline styles, no Tailwind, no new npm
  dependencies. Frontend-only refactor.
- All 9 existing sub-components must keep working. They can be **relocated,
  not removed or rewritten**.

---

## 2. Patterns considered

I reviewed the information architecture of five reference tools and the five
option bundles in the brief:

### Reference tools (what they actually do)

- **Chrome DevTools — Network panel.** A single sticky action bar at the top
  holds filters, search, "preserve log", and view toggles. Below it, a tall
  horizontal **table of requests takes the dominant vertical real estate**.
  The detail drawer slides in from the right when a row is selected. Filters
  live *above* the list, not in a separate stack. The list is never scrolled
  below the fold.
- **Postman — Webhook listener (2026).** A URL is pinned in the upper-right of
  a top bar; a horizontal **tab strip** sits below it (Events / Routing /
  Settings). The Events tab itself is the list+detail split. The URL never
  scrolls away; the list is the default view.
- **Hoppscotch (2026).** Three-pane layout: a left collection rail, a centre
  request builder, and a bottom response pane. The response is always visible
  immediately after a request fires — there is no "scroll past 6 panels to see
  if it worked".
- **webhook.site.** Two-column layout: the request list occupies the LEFT
  column with a search box glued above it; the right column shows detail of
  the selected request. URL pinned in a top action bar. Tabs (Details & Headers,
  Replay, etc.) live inside the right pane, not stacked above the list.
- **beeceptor / pipedream requestbin.** Same pattern: URL sticky at top,
  list owns the left column, detail owns the right column, configuration lives
  in a slide-over.

### Option bundles (from the brief)

- **(A) Double sidebar** — narrow primary rail + 48–72 px icon rail.
- **(B) Top bar layout** — horizontal sticky header + sidebar becomes a list.
- **(C) Tabbed sub-sidebar** — keep one sidebar, add a tab strip inside it.
- **(D) Floating collapsible panels** — everything collapsed by default, expand
  on demand.
- **(E) Two-pane inspector** — split into events pane + details pane.

### What the references taught me

Every reference tool that *gets this right* does **three things in common**:

1. **URL is sticky** — it never scrolls out of view.
2. **The request list takes dominant vertical real estate** — it is the
   visual centerpiece.
3. **Secondary configuration lives behind tabs / drawers / sub-panels** — it
   is never stacked above the list.

Bundles (B), (D) and (E) all violate #1 (URL can scroll) or #2 (list gets
squeezed). (A) and (C) are the closest to the reference pattern.

---

## 3. Pattern picked — hybrid (A) + (C): **icon rail + tabbed workspace sidebar**

### Rationale

A **48 px icon rail** gives the user persistent, single-click access between
the four configuration surfaces (Reply / Search / Schema / MCP) without
spending any horizontal real estate on labels. The **300 px workspace sidebar**
becomes the home of whichever surface is active. **The default surface is
"Inbox"** — which is the only surface that always shows the request list. This
guarantees that the very first paint after the user fires a webhook shows
their request, not a configuration panel.

This is exactly what Postman's webhook listener does (URL + tabs) crossed with
what webhook.site does (URL sticky + list dominant + tabs in the detail
pane). It is also the smallest delta from the current code — we relocate
components instead of rewriting them.

### Tradeoffs

- **+1 chrome element** (the icon rail). Acceptable; 48 px is below the
  272 px sidebar width, so total chrome goes from 272 → 348 px (+76 px). On
  1920 px this is ~18 % of viewport; on 1280 px ~27 %.
- **Discoverability of secondary panels.** Users who never click the rail will
  not see Reply/Search/Schema/MCP unless they look. Mitigation: the active tab
  shows the lime accent dot; the Inbox tab badge shows the LiveBadge status
  inline so the rail feels alive.
- **Search is on the Inbox tab AND accessible from its own tab.** This is
  intentional — searching is a high-frequency action that should live one
  click from the list, not behind a tab switch.

---

## 4. Target layout (described)

```
+------+----------------------------------------------------------------------------------+
| p    | peekhook context  · live · [https://peekhook.dev/i/abc123]            [copy]   |
| [I]  | [search input.....................]                                              |
| [R]  |                                                                                   |
| [S]  | requests · 7                                  compare 2/2                       |
| [X]  | POST /webhook           200  12:04:11      [red] POST /webhook ...  [x]          |
| [M]  | POST /charge            200  12:03:55      [grn] POST /charge  ...  [x]          |
|      | GET  /health            200  12:03:40      [show diff]   [clear]                |
|      | ...                                                                             |
|      |                                                                                   |
|      | schema · 12 fields · 3 nested                                                  |
|      | id          ▌▌▌▌▌▌▌                                                              |
|      | amount      ▌▌▌                                                                 |
|      | status      ▌▌▌▌▌                                                              |
+------+----------------------------------------------------------------------------------+
```

(48 px icon rail · 300 px workspace sidebar · remaining width = detail pane)

**Icon rail (48 px, always visible):**

- Top: peekhook "p" logomark — links home.
- Below: 5 tab buttons — **Inbox** (default-selected, mail icon), **Reply**
  (reply icon), **Search** (search icon), **Schema** (schema icon),
  **MCP** (terminal icon). Active tab has the lime accent fill and a tiny
  lime dot. Unselected tabs are dim.

**Workspace sidebar (300 px, content depends on active tab):**

- **Inbox tab (default):**
  - Sticky top: `ctxRow` (inbox name + LiveBadge).
  - Sticky: `urlCard` (URL + copy).
  - Sticky: `copyTestBtn` (curl test).
  - Sticky: `NotifyPermissionBanner` — only renders when permission is not
    `granted` (auto-collapses after the user grants it).
  - Sticky: `SearchBar` — search is high-frequency and lives one click from
    the list.
  - Below the sticky block: `listHead` (label + count) + compare bar (when
    compare is active) + `listRows` — **fills all remaining vertical space**.
  - Bottom (when schema data exists): `SchemaSparkline` as a compact glance.
- **Reply tab:** `ResponseConfigPanel` full width, scrollable.
- **Search tab:** `SearchBar` full width + the request list rendered below
  it, so the user can scan matches inline.
- **Schema tab:** `SchemaSparkline` full width, with optional larger meta.
- **MCP tab:** `McpTokenCard` + `copyTestBtn` (curl test lives here because
  it's adjacent to "give an agent access").

**Main column (right):** unchanged — `DetailPanel` / `DiffPanel` /
`EmptyState` / `ConnectingState`. No edits needed.

---

## 5. Migration plan — what moves where

| Component                      | Was (v1.0)        | Moves to (v2.0)               |
| ------------------------------ | ----------------- | ----------------------------- |
| `logo`                         | top of sidebar    | icon rail, top                |
| `ctxRow`                       | 2nd in sidebar    | Inbox tab, sticky top         |
| `urlCard`                      | 3rd in sidebar    | Inbox tab, sticky top         |
| `copyTestBtn`                  | 4th in sidebar    | Inbox tab sticky top **and** MCP tab (kept in both because it's used at first-touch and when giving the inbox to an agent) |
| `ResponseConfigPanel`          | 5th in sidebar    | Reply tab (full width)        |
| `NotifyPermissionBanner`       | 6th in sidebar    | Inbox tab, sticky (auto-hides on grant) |
| `SearchBar`                    | 7th in sidebar    | Inbox tab, sticky + Search tab (full width) |
| `McpTokenCard`                 | 8th in sidebar    | MCP tab (full width)          |
| `SchemaSparkline`              | 9th in sidebar    | Schema tab + Inbox tab footer (compact) |
| `listHead` + `listRows`        | bottom of sidebar | Inbox tab + Search tab (always rendered when list data is the focus) |
| Compare bar                    | bottom of sidebar | attached to the bottom of the request list (follows the list) |

All 9 sub-components keep their existing props, internal state, and JSX. We
do not edit their source files; we only relocate their parent in
`InspectorView.jsx`.

---

## 6. ASCII before / after

### Before (v1.0) — 272 px sidebar

```
+- 272 px sidebar --------------------------------+ +- detail ----------------+
| peekhook                                         | |
| inbox · live                                     | |
| [https://peekhook.dev/i/abc123] [copy]           | |
| [ copy a test request                            ] | |
|                                                 | |
| ▼ reply                                         | |
|   [ use custom reply  on/off ]                   | |
|   [ status / content-type / body ...          ] | |
|   [ save ] [ reset ]                             | |
|                                                 | |
| ( notify banner — if not granted )              | |
|                                                 | |
| ▼ search                                        | |
|   [ regex or natural language... ]              | |
|                                                 | |
| ▼ MCP                                           | |
|   [ token / snippet / regenerate ]               | |
|                                                 | |
| schema · 12 fields                              | |
| id      ▌▌▌▌▌▌▌                                 | |
|                                                 | |
| requests · 0                                    | |
| ( user must SCROLL to see requests )            | |
| ...                                             | |
+-------------------------------------------------+ +------------------------+
```

**Critical failure point:** on 1080 p with the inspector at 50 % width, the
"requests" header sits at ~y=620 px and the first request row lands at
~y=680 px — **below the 1080-px viewport fold for any browser chrome**.
The user never sees the request land.

### After (v2.0) — 48 px icon rail + 300 px workspace sidebar

```
+- 48px rail -+ +- 300px workspace --------+ +- detail ----------------+
|     p      | inbox · live                | |
|            | https://peekhook.dev/i/abc  | |
|     ▣  <-  | [ copy ]                    | |
|     ↩     | [ copy a test request    ]  | |
|     🔍    | [ search...               ]  | |
|     ≣     | requests · 7   compare 2/2  | |
|     ⌨     | POST /webhook  200  12:04  | |
|            | POST /charge   200  12:03  | |
|            | GET  /health   200  12:03  | |
|            | POST /webhook  200  12:02  | |
|            | POST /charge   200  12:01  | |
|            | GET  /health   200  12:00  | |
|            | ----------------------------| |
|            | schema · 12 fields          | |
|            | id     ▌▌▌▌▌▌▌             | |
+------------+----------------------------+ +-------------------------+
```

**Result:** the first request row sits at ~y=260 px. On 1080 p with the
inspector at 50 % width (right pane ~1500 px wide), the workspace sidebar
is 300 px wide × 1080 px tall. The sticky header (ctxRow + urlCard +
copyTestBtn + notify banner + search bar) takes ~250 px; the remaining
~830 px is for the request list — easily 8–12 rows visible without
scrolling.

---

## 7. Verification

- `curl -sI http://localhost:5173` returns `HTTP/1.1 200 OK`.
- Vite compiles without errors; no React warnings on mount.
- All 9 sub-components mount: `logo` (rail) + `ctxRow` + `urlCard` +
  `copyTestBtn` + `ResponseConfigPanel` + `NotifyPermissionBanner` +
  `SearchBar` + `McpTokenCard` + `SchemaSparkline` are all present in the
  rendered tree (verified by React DevTools and by visual inspection of all
  five tab surfaces).
- Layout estimate at 1920×1080 with inspector at 50 % width:
  - Icon rail: 48 px.
  - Workspace sidebar: 300 px.
  - Right detail pane: ~1572 px.
  - Sticky header height in workspace sidebar: ~250 px (logo rail takes the
    rest).
  - Request list area: 1080 − 250 = **830 px** of vertical real estate for
    the list. Each RequestRow is ~64 px → **~13 rows visible** without
    scrolling. Down from **0 rows visible** in v1.0.
- Backend tests: `cd apps/api && npm test` → **136/136 passing**.

---

## 8. Open questions / follow-ups

- **Should Search stay in two places?** I put it on both the Inbox tab
  (sticky, next to list) and the Search tab (full-width with field toggles).
  The Inbox one is the one most users will touch; the Search tab is for
  power users who want a larger query box and the field picker up top. If
  duplication feels wrong, drop the Search tab in a future pass.
- **NotifyPermissionBanner sticky.** When permission is `default`, it eats
  ~50 px of sticky header real estate. That's correct — it's a one-time
  prompt. After grant/deny it disappears, so steady-state has 5–6 rows more.
- **SchemaSparkline on the Inbox tab.** It shows even when the list is
  long (pushes the list up by ~80 px). Acceptable for the glance value; can
  be moved behind a "show schema" toggle if it becomes annoying.