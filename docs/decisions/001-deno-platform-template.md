# ADR 001: Establish reusable Deno platform template

- Status: accepted
- Date: 2026-08-18
- Maintainer: docs owner
- Location: `docs/decisions/001-deno-platform-template.md`

## Context

Repository is becoming a reusable product platform template rather than a product-specific app.
It needs fixed runtime, app, library, tenancy, and sync boundaries before source migration starts.
Current implementation still uses `apps/web` and `libs/shared`; `apps/spa`, `apps/mpa`,
`apps/worker`, `libs/platform`, and `libs/domain` are target state, not completed components.

Current task and dependency configuration is
[`deno.jsonc`](https://github.com/spy4x/template/blob/main/deno.jsonc). Current source layout is
under [`apps`](https://github.com/spy4x/template/tree/main/apps) and
[`libs`](https://github.com/spy4x/template/tree/main/libs).

## Decision

### Purpose and runtime

Repository provides reusable API, client, worker, persistence, auth, CQRS, and offline sync
foundations. Product-specific rules stay outside platform primitives.

Deno is sole runtime and task runner. Development, checks, builds, and operations use `deno` and
`deno task`; Node.js, npm, pnpm, Yarn, and Bun commands are not allowed. Selected packages exposed
through Deno `npm:` specifiers are allowed where Vite, Preact, and Dexie require npm ecosystem
packages. They still execute through Deno.

### App boundaries

- `apps/api` owns HTTP REST transport, auth, authorization, CQRS dispatch, and sync endpoints.
- `apps/spa` owns offline-capable Preact/Vite UI and its Dexie projection.
- `apps/mpa` owns server-rendered multipage UI that does not require offline state.
- `apps/worker` owns asynchronous event handlers, projection updates, and integrations.
- Apps compose libraries. One app must not become another app's library.

### Library boundaries

- `libs/platform` contains reusable technical primitives and contracts. It imports no domain,
  server, client, or app code.
- `libs/domain` contains business rules plus command, event, and query contracts. It may depend on
  platform code, but not frameworks, storage adapters, clients, servers, or apps.
- `libs/server` contains Postgres, transport, auth, and integration adapters. It may depend on
  platform and domain code.
- `libs/client` contains browser, Dexie, Preact, and Vite adapters. It may depend on platform and
  domain code, but not server or app code.

### Group model

`PERSONAL` and `SHARED` are group kinds. Personal data belongs to a `PERSONAL` group; collaborative
data belongs to a `SHARED` group. Both kinds use same group IDs, membership checks, commands,
events, REST resources, and sync protocol. Authorization policy differs by group kind and member
role, not by separate personal and collaborative pipelines.

### Data, CQRS, and sync

Postgres is authoritative. Dexie is a disposable local projection and never resolves conflicts as
authority.

REST is external application protocol. Mutations enter CQRS command handlers; reads enter query
handlers. Command handlers validate group access before committing state and events. Sync command
handlers also validate idempotency key and expected entity version. Workers handle asynchronous
event effects and projections.

Sync follows these rules:

- Server issues cursor ordering committed changes for each group.
- Pull sends last cursor and receives ordered changes plus next cursor.
- Push sends group ID, idempotency key, and expected entity version with each command.
- Repeated idempotency key returns original result without applying mutation twice.
- Stale entity version is rejected with current authoritative version for reconciliation.
- Applied changes increment entity version before reaching Dexie projections.

### Distribution

Distribution is staged:

1. Git template while architecture and copy workflow change frequently.
2. JSR packages only for generic libraries proven across real products with stable public APIs.
3. CLI only after project generation and template upgrade workflows are stable.

## Consequences

- Current `apps/web` must migrate toward `apps/spa`; server-rendered and worker apps remain WIP
  until created.
- Current `libs/shared` must split by platform and domain responsibility.
- Postgres/Dexie reconciliation requires cursor, idempotency, and version metadata in every sync
  path.
- Some dependencies resolve from npm registry, but contributors still use Deno commands only.
- Library extraction and CLI work wait for repeated, proven use instead of speculative APIs.

## Maintenance

Architecture owners review this record. If runtime, boundaries, group model, sync contract, or
distribution sequence changes, add a new ADR and mark this record superseded; do not rewrite
accepted history.
