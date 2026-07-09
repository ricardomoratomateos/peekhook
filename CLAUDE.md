 # peekhook. Claude Code Instructions

## Scope
Public, anonymous webhook inspector. No auth, no SaaS baggage.

Per-inbox URL, capture any HTTP request, live SSE stream into the
inspector panel (method, headers, query, body, IP). Configurable
mock reply (status, content-type, body) to simulate failures.

MCP server (Streamable HTTP transport) lives at `POST /mcp` behind
the same Fastify process. Auth via `Authorization: Bearer <mcp_token>`
(SHA-256 hash lookup against the existing `inboxes` collection, no
per-tool credentials). 5 tools: `list_events`, `get_event`,
`search_events`, `diff_events`, `explain_event`. Distribution is a
single URL — paste into Claude Code / Cursor / Cline, no install.

## Tech
- Backend: Fastify, dual-target persistence via the `buildApp`
  DI factory (`apps/api/src/app.js`). Hosted target
  (`src/index.js`) wires `Mongo*` adapters, TTL 7 days on
  `inboxes` and `requests`. Local target (`src/cli.js`) wires
  `Sqlite*` adapters. Every port has both impls; domain/app
  layers are identical.
- Frontend: Vite + React 18 + react-router-dom 6, no SSR
- CLI: `apps/cli` (`@peekhook/cli`), Bun runtime, ships the
  `peekgrok` binary — local-first stack over `bun:sqlite` +
  optional ngrok tunnel. Data in `~/.peekhook/peekgrok.db`.
- Storage: MongoDB (hosted) or SQLite (local), both ephemeral

## Design system
Read DESIGN.md before any visual/UI decisions. The Inspector shell
borrows the monochrome + electric-lime palette from this file.

## Skill routing

When the user's request matches an available skill, ALWAYS invoke it via
the Skill tool as your FIRST action. Do not answer directly.

Key routing rules:
- Product ideas / brainstorming → /office-hours
- Bugs / errors / 500 → /investigate
- Ship / deploy / PR → /ship
- QA / test the site → /qa
- Code review / diff check → /review
- Architecture review → /plan-eng-review
- Design / brand → /design-consultation or /plan-design-review
- Visual polish on the live site → /design-review
- Save progress → /context-save
- Resume context → /context-restore

## Repo conventions
- Package manager: pnpm workspaces (`pnpm-workspace.yaml`,
  `packageManager` pinned in root `package.json`). Build scripts are
  blocked by default; allowlist via `pnpm.onlyBuiltDependencies`
  (currently `esbuild`, `mongodb-memory-server`). CLI still runs on
  Bun at runtime.
- ESM throughout (`type: "module"` in both apps)
- Hex pattern: `domain/`, `app/`, `infra/` per use case
- API path: `/api/inboxes/...`. Ingest: `/i/:token`
- Frontend proxy: vite forwards `/api` to Fastify on :3000
- Ingest endpoint accepts POST/PUT/PATCH/DELETE; GET 405
