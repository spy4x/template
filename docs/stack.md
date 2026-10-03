# Stack, infrastructure and deployment

Replaces the former `3.architecture`, `4.tech-stack`, `5.deployment`,
`6.infrastructure` and `7.recommendations-expanded` files, which were thin
fragments of a numbered series that no longer exists and had drifted from what
the repository actually contains.

Boundaries and transport rules are decided in
[ADR 001](decisions/001-deno-platform-template.md) and
[ADR 002](decisions/002-realtime-transport-and-sync.md). This file only records
what is running and how it is deployed.

## Apps

| App | Stack | Transport |
| --- | ----- | --------- |
| `apps/api` | Deno, Hono | REST plus the `/api/ws` socket for group calls (ADR 002) |
| `apps/spa` | Preact, Vite, PWA | Group, note, profile and push calls over the socket; REST for auth, bootstrap and the pull |
| `apps/mpa` | Fresh | The public website; REST to the API for the newsletter only |
| `apps/worker` | Deno | No inbound transport; drains `outbox_events` |

## Services in compose

Defined in `infra/compose/`:

- **Postgres** - authoritative store. No PgBouncer; connection pooling is
  handled by the driver.
- **Valkey** - cache for display data (sessions and every authentication decision come from
  Postgres). The host needs `sysctl vm.overcommit_memory=1`. Postgres and Valkey are published on
  `127.0.0.1` only, through `DB_HOST_PORT` and `KV_HOST_PORT`, and Valkey requires `KV_PASSWORD`
  (`--requirepass`; the API sends it with `AUTH` on every connect and reconnect, and neither the API
  nor Valkey starts without it). The password reaches the container through its environment, so it
  is not in the command line; the healthcheck reads it from `REDISCLI_AUTH`.
- **Migrate** - one-shot: runs `deno task db:migrate` in the API's image on every `compose up`,
  then exits. The API and the worker wait for it to exit with 0 (`service_completed_successfully`),
  so a deploy never serves traffic on the old schema, and a failed migration fails the deploy. With
  nothing pending it changes nothing; the runner in `@spy4x/server/db` locks and checksums.
  `tests/compose-migrate.test.ts` holds that order.
- **Worker** - `apps/worker` in the API's image (same Dockerfile and build context) with its own
  command. It drains `outbox_events`, announces committed group changes with `pg_notify` (the API
  turns each into a live hint for other tabs) and sweeps expired idempotency keys hourly. No
  published port. Its pool (at most 10 connections) plus the API's (at most 10, plus one `LISTEN`
  connection) and postgres-exporter stay under Postgres' `max_connections=30`; raise that before
  raising either pool. `WORKER_CPU_LIMIT` and `WORKER_MEM_LIMIT` default to 0.5 CPU and 256M.
- **MinIO** - object storage, with a one-shot configure container.
- **Traefik** - reverse proxy, production compose only.
- **Loki, Prometheus, Grafana, postgres-exporter** - this project's logs and metrics. Loki stores
  what is pushed to it; nothing pushes until Promtail runs.
- **Promtail, node-exporter, cAdvisor** - watch the whole host (all containers' logs, host CPU,
  disk, network). Behind the `host-monitoring` compose profile, off by default so a shared server
  does not get a second copy of its own monitoring. Turn on with
  `COMPOSE_PROFILES=host-monitoring` in the env file; Prometheus keeps their scrape jobs and shows
  them as down while they are off.
- Images are pinned to a version (postgres-exporter to a digest, because upstream never tagged the
  build in use); change a pin on purpose, not by a moving `latest`.
- Traefik router, service and middleware names all end in `-${PROJECT}`.

## Deployment

Docker Compose for both local development and single-node production. Scaling is
vertical, through per-service resource limits.

CI is Woodpecker. `.woodpecker/ci.yml` runs `deno task check`, the SPA build, the integration
tests against a Postgres service and the `url-filters` browser test on every pull request and every
push to `main`; see [woodpecker-ci-setup.md](woodpecker-ci-setup.md). Deploys are not wired up
(`.woodpecker/deploy.yml.example`).

## Conventions worth keeping

- Authentication at the transport, session strength and cross-cutting checks in
  the CQRS dispatch pipeline, group membership and role in the repository. See
  ADR 002.
- Validate every input server-side; the client is untrusted.
- HTTPS everywhere.
- Standard log fields: `request_id`, `user_id`, `group_id`, route, duration.
- Per-feature security checklist: authentication, authorization, input
  validation, rate limiting.
