# Architecture

Moved from the README. [ADR 001](decisions/001-deno-platform-template.md) and
[ADR 002](decisions/002-realtime-transport-and-sync.md) are authoritative; this page summarises
them. The diagram in the README, [`architecture.svg`](architecture.svg), shows what exists today.

## Migration status

> **Migration status: WIP.** App boundaries, group core persistence, signup personal groups,
> basic group REST/CQRS, and the `libs/shared` split into `libs/platform` and `libs/domain` now
> exist. Notes/sync, group administration, MPA, and worker behavior stay incomplete. Target
> architecture below and ADR 001 are authoritative.

## Database evolution

Database evolution is forward-additive. Group-core DDL and personal-group backfill use separate
migrations; backfill is idempotent and safe to rerun during rollout.

## Target architecture

Apps compose bounded domain and platform libraries: Postgres is authoritative, browser data is
a Dexie projection, and REST endpoints dispatch CQRS flows with versioned, cursor-based,
idempotent sync.

Target apps:

- `apps/api`: REST, auth, authorization, CQRS dispatch, and sync transport.
- `apps/spa`: offline-capable Preact/Vite client backed by Dexie.
- `apps/mpa`: server-rendered multipage client for flows that do not need offline state.
- `apps/worker`: asynchronous event handlers, projections, and integrations.

Target libraries:

- `libs/platform`: reusable technical primitives and contracts. Today these come from the
  published `@spy4x/*` packages (spy4x/ts-libs) at an exact pinned version, not from code here.
- `libs/domain`: business rules, commands, events, and queries.
- `libs/server`: Postgres and server-side adapters.
- `libs/client`: Vite adapters. Preact UI comes from the `@spy4x/preact-*` packages.

`PERSONAL` and `SHARED` groups use one authorization and sync model. Full boundary and sync rules
are recorded in [ADR 001](decisions/001-deno-platform-template.md).

Distribution proceeds in stages: Git template first, proven generic libraries on JSR second,
then a CLI after generation and upgrade flows stabilize.

## Documentation

- [Architecture decision](decisions/001-deno-platform-template.md)
- [Realtime transport and sync protocol](decisions/002-realtime-transport-and-sync.md)
- [Group sync design](design/group-sync.md)
- [Realtime transport and sync-on-reconnect](design/realtime-websockets.md)
- [Contributing](../CONTRIBUTING.md)
