# peekhook. Design System

Minimal monochrome canvas with a single electric-lime accent. Tuned
for a developer-tool product: dark surface stack, sharp 4px radii,
no marketing fluff. Tweak deliberately.

## Color tokens

| token          | value         | role                         |
| -------------- | ------------- | ---------------------------- |
| `--bg`         | `#0a0a0a`     | page background              |
| `--surface`    | `#111111`     | sidebar / panels             |
| `--surface-2`  | `#171717`     | hover / inactive controls    |
| `--surface-3`  | `#1f1f1f`     | selected / active            |
| `--text-strong`| `#fafafa`     | primary text                 |
| `--text-body`  | `#a3a3a3`     | secondary text               |
| `--text-muted` | `#838383`     | muted / labels               |
| `--border`     | `rgba(64,64,64,.16)` | soft separators     |
| `--border-strong`| `rgba(64,64,64,.3)` | panel borders      |
| `--accent`     | `#c8ff00`     | electric-lime accent         |
| `--accent-ink` | `#0a0a0a`     | text on accent               |
| `--green-10`   | `rgba(200,255,0,.10)` | accent at 10% (selected rows) |
| `--status-red` | `#f87171`     | error messages               |

## Typography

- Sans: `Geist`, fallback to system sans
- Mono: `Geist Mono`, fallback to `SFMono-Regular`, monospace

Body copy: 13–14px / line-height 1.5
Labels / eyebrows: 10–11px mono, letter-spacing 0.2em, uppercase
Headlines: clamp(44, 7vw, 76) / line-height 0.98 / letter-spacing -2px (landing only)
Page headlines (inspector): 22px mono / line-height 1 / letter-spacing -0.5px

## Spacing

4 / 8 / 12 / 16 / 24 / 32 grid. Stay on multiples.

## Motion

- Pulse: `sbpulse 2s ease infinite` on dot indicators
- Fade-in on new events: `sbfade .3s ease`
- Hover transitions: 120–150 ms
- New request rows animate in from the left with `sbfade .3s ease`

---

# Inspector UI patterns

The Inspector shell (`apps/web/src/features/inspector/InspectorView.jsx`)
has a stable, opinionated shape. Once you understand the primitives,
adding a new tab is a 15-line page component.

## Shell

```
+------+---------------------------------------------------------------+
|  p   |                                                               |
| ---  |                  full-page tab content                        |
| [I]  |                                                               |
| [R]  |                                                               |
| [S]  |                                                               |
| [M]  |                                                               |
+------+---------------------------------------------------------------+
  48px                         remaining width
```

- **Icon rail (48 px).** Always visible. Top: home logo link. Below: one
  button per tab. Active tab = `--surface-3` fill + lime accent dot.
- **Page area (flex).** One tab is mounted at a time. No nested sidebars.

This replaces the earlier "icon rail + 300 px workspace sidebar + detail
pane" layout (`apps/web/designs/inspector-2026.md` is the historical
design doc for that abandoned iteration).

## Page header

Every tab page starts with the same header shape:

```
SANDBOX · INBOX                                  [url card] [copy test]
inbox / live                       ● live
```

Structure:

1. **Breadcrumb eyebrow.** `SANDBOX · <TAB>` in 11px mono uppercase,
   `--text-muted` color, letter-spacing 0.22em. Sourced from `d.eyebrow`
   in `styles.js`.
2. **Headline row.** Tab noun + `/` + page noun in 22px mono, weight 500,
   letter-spacing -0.5px. Sourced from `d.headlineRow` / `d.methodLg` /
   `d.pathLg`. Active state (e.g. `● live`, `+N new since capture`) hangs
   off this row as a chip.
3. **Right-aligned actions.** URL card, copy test request, refresh button,
   etc. Sits in a `pageHeaderRow` flex row aligned `space-between`.

Padding: `26px 26px 18px`, `border-bottom: 1px solid var(--border)`.
Background: `--surface`.

## Master-detail (Inbox only)

The Inbox tab is the only one that keeps a master-detail split. Everything
else is single-column full-page content.

```
+-- 380px master -----+--- detail (flex 1) ---+
| [search bar       ] | SANDBOX · INBOX        |
| REQUESTS · 7        | event · 8m ago         |
| [ ] POST /webhook   | post /                 |
| [ ] POST /charge    | [+2 new since capture] |
| [ ] GET  /health    | ip · ct · size         |
| [ ] ...             | query                  |
| COMPARE 1/2         | headers                |
| [A] POST /webhook   | body                   |
| [show diff] [clear] |                        |
+---------------------+------------------------+
```

- Master pane (`s.masterPane`): 380 px wide, scrollable request list,
  compare bar pinned at the bottom of the list when compare is active.
- Detail pane (`s.detailPane`): flex 1, holds `DetailPanel` /
  `DiffPanel` / `EmptyState` / `ConnectingState`.

The detail panel uses its own contextual eyebrow, not a duplicate of the
page breadcrumb: **`event · 8m ago`** (relative time). This is the only
place where the eyebrow is dynamic.

## Tab pages

Each tab has its own page component under
`apps/web/src/features/inspector/pages/`:

| Tab    | Page            | Content                                       |
|--------|-----------------|-----------------------------------------------|
| Inbox  | `InboxPage`     | master-detail as above                        |
| Reply  | `ReplyPage`     | section title + status pill + custom-reply toggle + form card |
| Schema | `SchemaPage`    | section title + top-level fields table + nested fields table |
| MCP    | `McpPage`       | section title + token card + curl snippet     |

All four share `s.page` + `s.pageHeader` + `d.eyebrow` + `d.headlineRow`.
The right-side actions in the header are tab-specific.

---

# Component patterns

## Status pill (Reply)

`pillOn` / `pillOff` from `rc` in `styles.js`. Pill on a 1px border, 3px 8px
padding, rounded 999px. Lime dot inside the pill indicates "on".

```
RESPONSE                                    default · 200
RESPONSE                                    ● custom · 200
RESPONSE                                    ● script · 200
```

## Section card

`rc.card` / `mc.card` / `sc.card`. Same shape everywhere: 1px border,
8px radius, `--bg` background, 16-18px padding, flex column with 14px
gap. Use for any group of related form fields or content.

## Section title

`sectionTitle` from `rc` / `mc` / `sc`. 10px mono uppercase, faint,
0.22em letter-spacing. Pairs with `sectionHead` flex row when a pill or
meta needs to sit on the right.

## Type tag (Schema)

Pill: 1px border, 2px 7px padding, 3px radius, `--surface` background.
Used in the schema table to label field types (`string`, `number`,
`array`, etc.).

## Sparkline

3px-wide bars, accent color, opacity 0.4 except the latest bar (1.0).
Heights cycle `[4, 6, 8, 10, 12]`. Caps at 14 bars, then a `+N` overflow
label. Used in the schema table and on Inbox request rows (compact).

## URL card

Inline `urlCard` + `copyBtn`. URL text is 11.5px mono, `--text-body` color,
truncates with ellipsis. Copy button on the right with `content_copy` icon
→ `check` for 2s on click. Used in the Inbox page header (always visible).

## Token display (MCP)

`mc.tokenRow` — large mono token (13px) inside a bordered row, copy button
on the right labeled "copy" (not just an icon) so the affordance is obvious.

## Compact search bar

A single horizontal row: search icon + input + field pill.

```
[🔍 search requests…                          body]
```

Click the `body` pill to cycle through `body` → `path` →
`header:user-agent`. While typing, an inline dot + match count appear
between the input and the pill.

## Compare bar

Pinned at the bottom of the master pane (only visible when 1-2 requests
are selected for compare). Two pill rows (red dot = A, green dot = B)
plus `[clear]` + `[show diff]` actions.

## Compare / diff

Selecting two requests and clicking **show diff** swaps the detail pane
to `DiffPanel`: side-by-side headers + bodies, with character-level diff
on changed lines and red/green highlight on removed/added blocks.

---

# Screenshots

| Tab    | Screenshot                                        |
|--------|---------------------------------------------------|
| Inbox  | `apps/web/designs/screenshots/inbox.png`          |
| Reply  | `apps/web/designs/screenshots/reply.png`          |
| Schema | `apps/web/designs/screenshots/schema.png`         |
| MCP    | `apps/web/designs/screenshots/mcp.png`            |

These were captured against a localhost dev server after firing 3 mixed
test requests (`POST /webhook` with nested user object, `POST /login`,
`GET /`). Re-run `/qa` to refresh if the UI drifts.

---

# Tokens reference

All values are mirrored into JS via `apps/web/src/features/inspector/lib/tokens.js`
so React components can use `c.accent`, `c.border`, `c.mono` etc. without
hardcoding hex values. When you change a CSS variable in `apps/web/src/styles.css`,
update the matching entry in `tokens.js` too.

## Radii

- Inputs / selects / cards: `6px`
- Pills / status chips: `999px`
- Page panels: `8px` (cards) / `0px` (master pane, no rounding inside the shell)

## Borders

- Cards: `1px solid var(--border-strong)` (`rgba(64,64,64,.3)`)
- Soft separators (between rows, under headers): `1px solid var(--border)` (`rgba(64,64,64,.16)`)

## Animation classes (defined in `animations.css`)

- `.sb-link` — nav links, color transition on hover
- `.sb-copy` — copy buttons, surface-3 fill on hover
- `.sb-copytest` — copy-test buttons, surface-3 + accent border on hover
- `.sb-accent` — primary CTA (lime), darker lime + lift on hover
- `.sb-reqrow` — request list rows, surface-2 fill on hover
- `.sb-replybtn` — collapsible toggles, surface-2 fill on hover
- `.sb-switchrow` — toggle rows in Reply page, surface-2 fill on hover

Add new global hover styles here, not inline.