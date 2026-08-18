# Deno Platform Template

Reusable Deno repository baseline for products that need API, web, worker, persistence, and
offline sync foundations without product-specific business logic.

> **Migration status: WIP.** Current tree contains `apps/api`, `apps/web`, and
> `libs/client`, `libs/server`, and `libs/shared`. Target directories below are not all present
> yet. Target architecture below and ADR 001 are authoritative. Existing feature-specific code
> and older docs remain as migration history.

## Deno policy

- Use Deno runtime and `deno task` for development, checks, builds, and operations.
- Do not use Node.js, npm, pnpm, Yarn, or Bun commands.
- Selected `npm:` dependencies may run through Deno when required by Vite, Preact, or Dexie.
  This exception does not permit another runtime or task runner.

## Quick start

Current tasks come from
[`deno.jsonc`](https://github.com/spy4x/template/blob/main/deno.jsonc).

```sh
deno task proxy:start
deno task dev
```

Stop local proxy:

```sh
deno task proxy:stop
```

Run repository checks:

```sh
deno task check
```

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

- `libs/platform`: reusable technical primitives and contracts.
- `libs/domain`: business rules, commands, events, and queries.
- `libs/server`: Postgres and server-side adapters.
- `libs/client`: browser, Dexie, Preact, and Vite adapters.

`PERSONAL` and `SHARED` groups use one authorization and sync model. Full boundary and sync rules
are recorded in
[ADR 001](https://github.com/spy4x/template/blob/main/docs/decisions/001-deno-platform-template.md).

Distribution proceeds in stages: Git template first, proven generic libraries on JSR second,
then a CLI after generation and upgrade flows stabilize.

## Documentation

- [Architecture decision](https://github.com/spy4x/template/blob/main/docs/decisions/001-deno-platform-template.md)
- [Contributing](https://github.com/spy4x/template/blob/main/CONTRIBUTING.md)

## Maintenance

Maintainer: docs owner. This file lives at repository root. Update it when target architecture,
migration status, valid `deno task` commands, distribution stages, or documentation links change.
