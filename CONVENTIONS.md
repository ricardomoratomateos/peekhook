# Engineering Conventions

This document is the source of truth for how PeekHook code is
written. Every parallel agent reads it first. Anything not in
here is the agent's call, but the conventions below are
non-negotiable — they keep the codebase mergeable across
independent work streams.

## Stack

- **Backend**: Node 20+, Fastify 4, native ESM (`"type": "module"`).
- **Frontend**: Vite 5, React 18, react-router-dom 6, native ESM.
- **CLI**: Bun runtime, `apps/cli` (`@peekhook/cli`), ships the
  `peekgrok` binary via `bun build --compile`.
- **Storage**: dual-target. MongoDB for the hosted target
  (one database, multiple collections); `bun:sqlite` for the
  local `peekgrok` target (one file, `~/.peekhook/peekgrok.db`).

## Layering (backend)

Every module follows the same shape. New code goes in
`apps/api/src/<module>/` with three layers. There is no
`features/` umbrella — modules are siblings of `src/`.

```
src/<module>/
  domain/         pure aggregates + ports. NO infra imports.
  app/            use cases (one class per use case).
  infra/
    http/         Fastify route handlers.
    persistence/  Mongo adapters (only for adapter shape).
```

The inbox core (`src/inbox/`) is itself a module by this rule.
It owns `/api/inboxes/...` (the inspector feed) and
`/i/:token` (the public ingest endpoint). All other modules
sit alongside it as siblings.

Existing shares (`apps/api/src/shared/`) holds cross-module
infrastructure only: Mongo connection, config, audit. Do not
add module code to `shared/`.

## Hexagonal boundaries (hard rules)

- **domain/** must NOT import from `app/`, `infra/`, `shared/`, or
  `mongodb`. If you need a database, define a port interface
  in `domain/` and let the infra implement it.
- **app/** must NOT import from `infra/http/` or
  `infra/persistence/`. Use cases take port implementations
  via constructor (`new RunScript({ runner })`).
- **infra/** must NOT import from `app/` or other features'
  `domain/`. Cross-feature dependencies go through ports
  defined in the consumer feature's `domain/`.

## Validation

Use plain JavaScript for now. No zod, no class-validator.
Throw `Error` from validators with messages that start with
the field name (`"status must be 100-599"`). Capture use cases
wrap validation failure in an `Outcome.INVALID` pattern (see
`apps/api/src/domain/Outcome.js`).

## Tests

- **Framework**: Vitest. Run with `pnpm test` from `apps/api` (or `pnpm --filter @peekhook/api test` from the root).
  - **Flaky under load**: the `WorkerThreadRunner` scripting-sandbox
    tests assert a 200ms wall-clock timeout. Under full file
    parallelism on a busy machine (or a loaded CI runner) worker
    startup alone can blow that budget, so they fail intermittently
    with `expected 'timeout' to be 'ok'`. It's a timing artifact, not
    a logic bug. Run `npx vitest run --no-file-parallelism` (from
    `apps/api`) for a deterministic green — each file gets the CPU to
    itself. Use this in CI, or when a run fails only on WorkerThreadRunner.
- **Domain + app unit tests**: pure JS, no Mongo. Use in-memory
  port fakes defined inline in the test file.
- **Persistence integration tests**: `mongodb-memory-server`,
  starts a real Mongo in a tmp dir. Use the helpers in
  `test/helpers/mongoMemory.js` (see seed test path).
- **HTTP route tests**: `fastify.inject()` against the
  registered route, no listen needed.

Test file naming: `<Layer>.<Name>.spec.js`, side-by-side with
the source file. E.g. `app/RunScript.spec.js` next to
`app/RunScript.js`.

A test must be deterministic, fast (<200ms per case), and
read-clean. Fake ports inline; never reach for a global
container.

## Persistence

Mongo collection names: plural, snake_case. One index per
hot query.

```
inboxes             { token: 1, unique }                     TTL on expiresAt
requests            { inboxToken: 1, createdAt: -1 }         TTL on expiresAt
```

For new features adding new collections, follow the same
naming pattern. Index list goes in `apps/api/src/shared/db.js`
`connectDb()` and references the collection's TTL field if
applicable.

### Dual-target adapters (Mongo + SQLite)

Every persistence port defined in a module's `domain/` has two
adapters in `infra/persistence/`: `Mongo<Port>` (hosted) and
`Sqlite<Port>` (local `peekgrok`). The domain and app layers
never know which is wired — that choice lives in the entry
points:

- `apps/api/src/index.js` — hosted, wires the `Mongo*` adapters.
- `apps/api/src/cli.js` — local, wires the `Sqlite*` adapters
  against a `bun:sqlite` handle the `peekgrok` binary passes in.

Both call the `buildApp(deps, options)` factory in `app.js`,
which decorates the Fastify instance with whatever adapters it
receives. **When you add a new persistence port, add both
adapters and wire them in both entry points.** SQLite adapters
export an idempotent `migrate(db)`; `cli.js` calls it at boot.
Do not import `bun:sqlite` at module top-level in `apps/api` —
the package must stay Node-compatible for the existing test
suite (the `db` handle is injected by the caller).

## HTTP API conventions

- Plural collection names in routes (`/api/inboxes`, not
  `/api/inbox`).
- Bearer tokens in the `Authorization: Bearer <token>` header
  for any feature that introduces auth.
- Body content-type: `application/json` for routes that expect
  it. The ingest endpoint (`/i/:token`) is the only one that
  accepts arbitrary content-types via a wildcard parser.
- Response shapes: success returns the resource or `{ok:true}`
  for command responses. Errors return
  `{error: "<message>"}` with appropriate 4xx/5xx status.

## Naming

- Domain aggregates: PascalCase (`SandboxInbox`,
  `CapturedRequest`, `RunScript`).
- Ports: PascalCase + `Repository` / `ReadModel` / `Service`
  suffix (`InboxRepository`, `RequestListReadModel`).
- Use cases: PascalCase verb-noun (`CaptureRequest`,
  `RunScript`, `ConfigureResponse`).
- Files match their primary export name.

## Frontend (web)

Layout lives in `apps/web/src/features/<feature-name>/`. We
follow the pattern set by `features/inspector/`:
`<Feature>View.jsx` as the main composition, `components/`,
`lib/`, `styles.js`, `animations.css` near it as needed.

The big `Inspector.jsx` monolith is gone. New UI for any
feature should touch at most:
- one new component in `features/inspector/components/` (for
  inspector-side UI), OR
- one new file in `features/<my-feature>/` if it's a
  standalone surface, OR
- the relevant page (`Landing.jsx` is for landing surface).

## Dependency policy

New dependencies that touch `apps/api/package.json` are
allowed but **must default to existing versions** of similar
libs. Don't introduce a new testing framework, an ORM, or a
validation lib without explicit user approval. Ask first.

Adding a dep is acceptable:
- `crypto-js` or similar for the scripting sandbox if `node:vm`
  isn't enough.
- New transport libs (won't add unless needed).
- Anything that a feature genuinely depends on.

## Commit messages

One logical change per commit. Subject ≤72 chars.
Body explains the WHY, references paths with
`file:line` notation. For features that span multiple files:
one commit per layer (domain, app, infra-http).

## What to NOT do (parallel-work safety)

- Don't edit files outside your feature folder without
  permission.
- Don't change `apps/api/src/index.js` to register routes in
  any way that breaks existing registrations. Add new lines,
  don't reformat.
- Don't reformat existing files. Match style 1:1.
- Don't bump dependency versions — keep them at the existing
  range.
- Don't touch `ROADMAP.md`. The orchestrator updates the
  roadmap after merge.

When in doubt: smaller change, smaller scope, more tests.
