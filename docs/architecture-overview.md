# Architecture Overview (High-Level)

## Intent
Deliver a small, auditable MVP with clear boundaries. Deno-first. CQRS-ready.

## Components
- **Webhook/Trigger Ingest**: receives GitHub Issues/Projects events.
- **API**: Deno service, auth middleware, CQRS boundary for domain logic.
- **Worker**: processes events, calls gh cli, writes audit trail.
- **DB**: Postgres for durable state.
- **KV/Cache**: Valkey for sessions/short-lived data.
- **Infra**: compose + deploy scripts.

## Data flow (happy path)
GitHub Event → API → Worker → gh cli → DB/KV → API

## Security
- HTTPS everywhere.
- authn/authz at edge + handlers.
- validate inputs server-side.

## Tradeoffs
- Reuse existing stack for speed.
- keep domain logic thin until requirements settle.
