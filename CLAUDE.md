# PeekHook — Claude Code Instructions

## Scope
Public, anonymous webhook inspector. No auth, no SaaS baggage.

Per-inbox URL → capture any HTTP request → live SSE stream → inspector
panel (method/headers/query/body/IP). Configurable mock reply (status,
content-type, body) to simulate failures.

## Tech
- Backend: Fastify + Mongo, TTL 7 days on `inboxes` and `requests`
- Frontend: Vite + React 18 + react-router-dom 6, no SSR
- Storage: MongoDB, ephemeral

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
- ESM throughout (`type: "module"` in both apps)
- Hex pattern: `domain/ → app/ → infra/` per use case
- API path: `/api/inboxes/...`, ingest: `/i/:token`
- Frontend proxy: vite forwards `/api` and `/i` to Fastify on :3000
