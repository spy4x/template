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
- **Valkey** - cache and session helpers. The host needs
  `sysctl vm.overcommit_memory=1`.
- **MinIO** - object storage, with a one-shot configure container.
- **Traefik** - reverse proxy, production compose only.
- **Loki, Promtail, Prometheus, Grafana, node-exporter, cAdvisor,
  postgres-exporter** - logs and metrics.

## Deployment

Docker Compose for both local development and single-node production. Scaling is
vertical, through per-service resource limits.

**There is no CI pipeline wired up.** `infra/configs/woodpecker-ci.yml` and
[woodpecker-ci-setup.md](woodpecker-ci-setup.md) describe an intended Woodpecker
setup, but no `.woodpecker.yml` exists at the repository root, so nothing runs on
push today. Treat CI as unbuilt.

## Conventions worth keeping

- Authentication at the transport, session strength and cross-cutting checks in
  the CQRS dispatch pipeline, group membership and role in the repository. See
  ADR 002.
- Validate every input server-side; the client is untrusted.
- HTTPS everywhere.
- Standard log fields: `request_id`, `user_id`, `group_id`, route, duration.
- Per-feature security checklist: authentication, authorization, input
  validation, rate limiting.
