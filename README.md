<div align="center">

# template

**The foundation I build SaaS MVPs on: auth, groups, an API, web clients, a worker and Postgres,
already wired together.**

[![License](https://img.shields.io/badge/license-MIT-blue)](LICENSE)

[Architecture](docs/architecture.md) · [ADR 001](docs/decisions/001-deno-platform-template.md) ·
[ADR 002](docs/decisions/002-realtime-transport-and-sync.md) · [Stack](docs/stack.md) ·
[Deno policy](docs/deno-policy.md)

<img src="docs/architecture.svg" alt="Architecture diagram. Clients: apps/spa, a Preact and Vite PWA with sign-up, sign-in, TOTP and profile, talks to apps/api over REST and WebSocket; a Dexie offline store with group sync is planned. apps/mpa is a Fresh page shell with /health; its REST calls are planned. Servers: apps/api on Hono (auth, groups, CQRS dispatch, web push) and apps/worker, which drains outbox_events. Data: Postgres is authoritative and Valkey is the API cache; Docker Compose also runs Traefik, MinIO, Loki, Prometheus and Grafana. Shared code: libs/domain, libs/server, libs/client and the @spy4x packages on JSR." width="860">

</div>

Fork it, fill in the env file, and you start with a product that already has accounts, a second
factor, tenancy and a place for background work. A new user signs up and gets an account, a
session and a personal group in one database transaction. Groups are the only tenancy boundary, so
the same membership checks and roles cover personal data and shared workspaces.

It exists because every SaaS MVP needs the same groundwork before its first feature. The reusable
parts live here and in the published [`@spy4x/*`](https://jsr.io/@spy4x) packages; product rules
stay out.

**Status:** in migration. Sign-up, sign-in with TOTP, groups over REST and the outbox worker work
today; offline sync, notes, group administration and the MPA's pages do not yet. Details in
[docs/architecture.md](docs/architecture.md#migration-status) and
[ADR 001](docs/decisions/001-deno-platform-template.md).

## Why template

- **Tenancy from day one.** Every user gets a `PERSONAL` group at sign-up; `SHARED` groups use the
  same IDs, membership checks and roles, from viewer to owner.
- **Auth that is done.** Sign-up, sign-in, sessions and an authenticator-app second factor, with
  PBKDF2-SHA-256 password hashes. Web push subscriptions are built in too.
- **CQRS with an outbox.** Commands, queries and events go through one bus. Creating a shared
  group writes its event to `outbox_events`, and the worker drains that table.
- **Safe API defaults.** Every mutation must come from the web app's own origin, and group lists
  page with HMAC-signed cursors.
- **Web standards.** Hono handlers take a `Request` and return a `Response`; ES modules, Preact
  and Fresh throughout, with Deno as the runtime.
- **Operations included.** Docker Compose for development and single-node production: Traefik,
  Postgres, Valkey, MinIO, Loki, Prometheus and Grafana.

**Use it if** you are starting a multi-user web product and want auth, tenancy and operations
settled before the first feature. **Skip it if** you need offline sync today, or you deploy to
serverless functions rather than a server you run.

## Quick start

```sh
cp infra/envs/.env.example infra/envs/.env
```

Before going on, edit `infra/envs/.env`: fill in the secrets, delete the comment after `ENV=dev` so
the line reads exactly `ENV=dev`, and add the line `CONTAINER_PROVIDER=docker`. The Compose script
keeps inline comments as part of the value and otherwise runs Podman, while `proxy:start` runs
Docker.

```sh
deno task vapid-key:create   # web push keys → infra/configs/vapid.json
deno task proxy:start        # Traefik
deno task dev                # Postgres, Valkey, MinIO, API, SPA, logs and metrics
```

The worker and the MPA are not in Compose; run them on the host. Stop the proxy with
`deno task proxy:stop`. Apply migrations from the host with the values from your `.env`, pointing
at the port Compose publishes:

```sh
DB_HOST=127.0.0.1 DB_PORT=5432 DB_USER=<user> DB_PASS=<password> DB_NAME=<name> deno task db:migrate
```

## Tasks

Current tasks come from [`deno.jsonc`](deno.jsonc).

| Task                         | What it does                                           |
| ---------------------------- | ------------------------------------------------------ |
| `deno task check`            | Lint, format check, type check and unit tests          |
| `deno task test:integration` | Integration tests against a Postgres you provide       |
| `deno task e2e`              | Playwright end-to-end tests                            |
| `deno task db:migrate`       | Apply the SQL migrations in `libs/server/db`           |
| `deno task spa:build`        | Build the SPA                                          |
| `deno task deploy`           | Copy the production files to the server and start them |

Run individual app tasks with `api:*`, `spa:*`, or `mpa:*`. Deno workspace members inherit shared
imports and tooling settings from root `deno.jsonc`.

## Development

```sh
deno task check
deno task hooks:install   # runs the checks before every commit
```

See [CONTRIBUTING.md](CONTRIBUTING.md) for the rules, and [HANDOFF.md](HANDOFF.md) for the state
of the migration and the traps in this codebase.

## Built by

I'm [Anton Shubin](https://antonshubin.com), a senior full-stack engineer and tech lead. This
template is the foundation I build client SaaS MVPs on. Need an MVP built for your product?
[That's my day job →](https://antonshubin.com/catalog/zero-to-production-saas-mvp)

Licensed under [MIT](LICENSE). Copyright (c) 2026 Anton Shubin.

---

Made by Anton Shubin · [antonshubin.com/tools](https://antonshubin.com/tools)
