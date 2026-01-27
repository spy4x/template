# template

Deno-first monorepo starter. Auth + web-push only. Minimal web shell. No domain logic.

## Purpose
- clean base for new apps
- infra + auth + sessions + push
- auditable, scalable, secure defaults

## What changed in this setup
- slug/domain set to `app` / `app.localhost`
- Traefik ping entrypoint fixed
- Postgres/Valkey images switched to Debian to avoid locale noise
- Valkey host requires `vm.overcommit_memory=1`
- auth cache bug fixed (`isSessionTokenExpired`)

## Structure
- `apps/api`: Deno + Hono API
- `apps/web`: Preact shell (no auth UI)
- `libs/*`: shared libs (helpers, cache, db, kv, types)
- `infra/*`: compose, env, deploy, scripts
- `docs/*`: principles, architecture, infra

## Stack
- Deno, Hono, Preact, Vite
- Postgres, Valkey
- Traefik, Loki/Prom/Grafana

## Run (dev)
```sh
deno task proxy:start
deno task dev
```
Open: https://app.localhost

Stop proxy:
```sh
deno task proxy:stop
```

## Auth API (no UI)
```sh
curl -sS -H "Content-Type: application/json" \
  -d '{"username":"user1","password":"Passw0rd!"}' \
  https://app.localhost/api/auth/password/sign-up

curl -sS -H "Content-Type: application/json" \
  -d '{"username":"user1","password":"Passw0rd!"}' \
  https://app.localhost/api/auth/password/check

curl -sS https://app.localhost/api/auth/me
```

## Env
- see `infra/envs/.env.example`
- copy to `infra/envs/.env`

## Notes
- money as ints, enums start at 1
- REST + WS ready, CQRS-ready
- deps minimized

## Tradeoffs
- minimal UI for speed
- auth only; no domain logic
