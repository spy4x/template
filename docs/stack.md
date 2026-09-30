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
| `apps/api` | Deno, Hono | REST today; WebSocket per ADR 002, not yet built |
| `apps/spa` | Preact, Vite, PWA | WebSocket per ADR 002; REST for auth and bootstrap |
| `apps/mpa` | Fresh | REST only, request/response, no realtime |
| `apps/worker` | Deno | No inbound transport; drains `outbox_events` |

## Services in compose

Defined in `infra/compose/`:

- **Postgres** - authoritative store. No PgBouncer; connection pooling is
  handled by the driver.
- **Valkey** - cache for display data (sessions and every authentication decision come from
  Postgres). The host needs `sysctl vm.overcommit_memory=1`. Postgres and Valkey are published on
  `127.0.0.1` only, through `DB_HOST_PORT` and `KV_HOST_PORT`. Valkey has no password yet:
  `RedisKvStore` in `@spy4x/server` cannot send `AUTH`, so the network binding is the only
  guard; anyone who can reach Valkey can write cached profile rows.
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
push to `master`; see [woodpecker-ci-setup.md](woodpecker-ci-setup.md). Deploys are not wired up
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
