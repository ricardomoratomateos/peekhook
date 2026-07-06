# PeekHook

A free, anonymous webhook inspector.

Generate a unique URL, send any HTTP request to it, inspect the
request in real time — method, headers, query params, body, IP.
Configure a custom mock reply (status, content-type, body) to
simulate downstream failures and test retry logic.

## Quick start

```bash
npm install
npm run dev
```

Frontend: http://localhost:5173
Backend: http://localhost:3000

Requires a local MongoDB:

```bash
brew install mongodb-community && brew services start mongodb-community
```

(or set `MONGODB_URI` to any reachable Mongo URL).

## Architecture

```
apps/
  api/   Fastify ingest at /i/:token + read API at /api/inboxes/...
  web/   Vite + React inspector UI
```

Hex layout per app:

```
src/
  domain/        pure aggregates + ports (no infra deps)
  app/           use cases
  infra/
    http/        Fastify routes
    persistence/ Mongo adapters
  shared/        cross-cutting (db connection)
```

## Status

MVP scaffold. Inspector works end-to-end. Inboxes TTL 7 days.
Domains still todos: JS scripting for mock reply, browser
notifications, MCP server, diff side-by-side.
