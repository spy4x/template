<div align="center">

# template

**A modern SaaS baseline built on web standards: auth with a second factor, groups, an API, web
clients, a worker and Postgres, already wired together.**

[![CI](https://ci.antonshubin.com/api/badges/11/status.svg)](https://ci.antonshubin.com/repos/11)
[![License](https://img.shields.io/badge/license-MIT-blue)](LICENSE)

```sh
gh repo create my-product --template spy4x/template --private --clone
```

<img src="docs/screenshots/sign-up-flow.gif" alt="A new user signs up with a username and password, lands on the profile page with the realtime connection open, types the first name Alex and the last name Rivera, and saves; a green toast confirms the profile was updated." width="800">

[Architecture](docs/architecture.md) · [ADR 001](docs/decisions/001-deno-platform-template.md) ·
[ADR 002](docs/decisions/002-realtime-transport-and-sync.md) · [Stack](docs/stack.md) ·
[Deno policy](docs/deno-policy.md) · [Adding an aggregate](docs/aggregates.md) ·
[Handoff](docs/handoff.md)

</div>

Create your repository from it, fill in the env file, and you start with a product that already
has accounts, a second factor, tenancy and a place for background work. A new user signs up and
gets an account, a session and a personal group in one database transaction. Groups are the only
tenancy boundary, so the same membership checks and roles cover personal data and shared
workspaces.

It exists because every SaaS MVP needs the same groundwork before its first feature. The reusable
parts live here and in the published [`@spy4x/*`](https://jsr.io/@spy4x) packages; product rules
stay out.

**Status:** in migration. Sign-up, sign-in with TOTP, groups, notes (the reference aggregate),
the outbox worker and the MPA's pages work today, and the SPA works offline
([docs/offline.md](docs/offline.md)); group administration does not yet. Details in
[docs/architecture.md](docs/architecture.md#migration-status) and
[ADR 001](docs/decisions/001-deno-platform-template.md).

## What a fresh project looks like

| Light                                                                                                                                                                                                 | Dark                                                                                                                                                                                                |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| <img src="docs/screenshots/sign-in-light.png" alt="The sign-in page in the light theme: a card titled Welcome back with username and password fields, a Sign in button and a link to sign up.">       | <img src="docs/screenshots/sign-in-dark.png" alt="The sign-in page in the dark theme: a card titled Welcome back with username and password fields, a Sign in button and a link to sign up.">       |
| <img src="docs/screenshots/profile-light.png" alt="The profile page in the light theme for the demo user Alex Rivera: name fields with a Save button, a change-password card and a two-factor card."> | <img src="docs/screenshots/profile-dark.png" alt="The profile page in the dark theme for the demo user Alex Rivera: name fields with a Save button, a change-password card and a two-factor card."> |

The screenshots and the GIF use a throw-away database and a made-up user;
[`docs/screenshots/record.ts`](docs/screenshots/record.ts) records them again from a running app.

<details>
<summary>How the parts fit together</summary>

<img src="docs/architecture.svg" alt="Architecture diagram. Clients: apps/spa, a Preact and Vite PWA with sign-up, sign-in, TOTP and profile, talks to apps/api over REST and WebSocket; a Dexie offline store keeps the last notes and groups and queues writes made offline. apps/mpa is a Fresh page shell with /health; its REST calls are planned. Servers: apps/api on Hono (auth, groups, CQRS dispatch, web push) and apps/worker, which drains outbox_events. Data: Postgres is authoritative and Valkey is the API cache; Docker Compose also runs Traefik, MinIO, Loki, Prometheus and Grafana. Shared code: libs/domain, libs/server, libs/client and the @spy4x packages on JSR." width="860">

</details>

## Why template

- **Tenancy from day one.** Every user gets a `PERSONAL` group at sign-up; `SHARED` groups use the
  same IDs, membership checks and roles, from viewer to owner.
- **Auth that is done.** Sign-up, sign-in, sessions and an authenticator-app second factor, with
  PBKDF2-SHA-256 password hashes. Web push subscriptions are built in too.
- **Offline-first SPA.** The SPA keeps the last notes and groups in IndexedDB (Dexie), opens with no
  network, and queues note writes with their idempotency keys. It sends them on reconnect and
  shows a stale write as a conflict to settle, never as a silent overwrite. The layer sits in one
  folder, so a product that does not want it deletes the folder and keeps an online SPA:
  [docs/offline.md](docs/offline.md).
- **CQRS with an outbox.** Commands, queries and events go through one bus. Creating a shared
  group writes its event to `outbox_events`, and the worker drains that table.
- **Safe API defaults.** Every mutation must come from the web app's own origin, and group lists
  page with HMAC-signed cursors.
- **Built on web standards.** Hono handlers take a Fetch `Request` and return a `Response`;
  password hashes and cursor signatures use Web Crypto; live updates travel over a standard
  WebSocket; everything is an ES module. The servers run on Deno 2 in Docker on any Linux host you
  control, and the clients run in any modern browser.
- **Operations included.** Docker Compose for development and single-node production: Traefik,
  Postgres, Valkey, MinIO, Loki, Prometheus and Grafana.

**Use it if** you are starting a multi-user web product and want auth, tenancy and operations
settled before the first feature. **Skip it if** you deploy to serverless functions rather than a server
you run.

## SPA or MPA

The template ships two web clients over the same API. A product picks one and serves it at
`DOMAIN`; both render the same screens from `libs/ui` and reach the same command and query
handlers, so no business rule lives in either client.

- **Pick the SPA** (`apps/spa`, Preact and Vite) when people should see each other's changes live,
  or when the app should work offline ([docs/offline.md](docs/offline.md)). It keeps a WebSocket open for groups and notes, as
  [ADR 002](docs/decisions/002-realtime-transport-and-sync.md) decides.
- **Pick the MPA** (`apps/mpa`, Fresh) when a page that reloads after each form is enough: an admin
  area, a back office, a product for people on old phones or behind strict script policies. Every
  page is rendered on the server and every action is a plain form post, so it works with
  JavaScript turned off. There is no socket; a change shows on the next page load.

The MPA calls the API over HTTP from the server, with the browser's session cookie, and never
touches the database itself. It needs `ENV` and `DOMAIN` (the same values as the API) and
`API_URL`, the address the MPA's server reaches the API at, such as `http://api:8000`. The browser
must reach the MPA at `DOMAIN`, with `/api` still going to the API: the API accepts a form only
from `http(s)://DOMAIN`, and the MPA passes the browser's `Origin` on unchanged. Compose serves
the SPA there by default. To serve the MPA instead, set `COMPOSE_PROFILES=mpa` in the env file
(join it with other profiles by commas) and run `deno task deploy` as usual: Compose then builds
the `mpa` service from `apps/mpa/dockerfile.prod`, and its Traefik router outranks the SPA's for
`DOMAIN`, leaving `/api` and `/ws` to the API. The SPA container still runs, unused. Without the
profile nothing about the deploy changes. The MPA's end-to-end test runs in CI on every pull
request, and locally with `e2e/mpa/run.sh` against a running Postgres and Valkey (see the header
of that script).

## Quick start

```sh
cp infra/envs/.env.example infra/envs/.env
```

Before going on, fill in the secrets in `infra/envs/.env` (`KV_PASSWORD` is the Valkey password;
Valkey and the API both refuse to start without it, `openssl rand -hex 24` makes one). It runs on
Docker; to use Podman, set `CONTAINER_PROVIDER=podman` (`proxy:start` and `proxy:stop` still call
Docker).

```sh
deno task vapid-key:create   # web push keys → infra/configs/vapid.json
deno task proxy:start        # Traefik
deno task dev                # Postgres, Valkey, MinIO, API, worker, SPA, Loki, Prometheus, Grafana
```

Promtail, node-exporter and cAdvisor watch the whole host, so they are off by default. Set
`COMPOSE_PROFILES=host-monitoring` in the env file to start them too.

To try the MPA in Compose, see "SPA or MPA". Stop the proxy with
`deno task proxy:stop`. Compose applies pending migrations on every start, in the one-shot
`migrate` service that the API and the worker wait for; a failed migration stops the start. To apply
them from the host instead, for an API run outside Compose, use the values from your `.env` and the
port Compose publishes:

```sh
DB_HOST=127.0.0.1 DB_PORT=5432 DB_USER=<user> DB_PASS=<password> DB_NAME=<name> deno task db:migrate
```

To add a demo user `demo` who owns a shared group, run `deno task db:seed` with the same values plus
`AUTH_PEPPER` (the API's) and `SEED_PASSWORD` (the demo user's password, 8 to 50 characters).

## Production certificates

The production routers ask Traefik for certificates from the resolver named by
`TRAEFIK_CERT_RESOLVER` (default `myresolver`). `infra/compose/compose.proxy.yml` defines that
resolver: Let's Encrypt, HTTP challenge on port 80, certificates stored in
`.volumes/traefik/letsencrypt/acme.json`, expiry notices to `TRAEFIK_ACME_EMAIL`. Point `DOMAIN` at
the server and run `deno task proxy:start` there.

`deno task deploy` needs no manual step on a new server: it creates `infra/configs/vapid.json`
(the web push keys) there when the file is missing, readable by its owner only. It never sends the
key from your machine and never replaces one that exists. Router, service and middleware names
carry `${PROJECT}`, so projects with different `PROJECT` values can share one Traefik. Postgres and
Valkey stay on `127.0.0.1`. Every image has a pinned version.

The template usually deploys behind a Traefik that several projects share. If that Traefik already
defines a resolver, do not start the proxy compose file: set `TRAEFIK_CERT_RESOLVER` to the name it
defines. If that Traefik defines none, copy the three `--certificatesresolvers.*` flags from
`compose.proxy.yml` into its command.

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

See [CONTRIBUTING.md](CONTRIBUTING.md) for the rules, and [docs/handoff.md](docs/handoff.md) for
the state of the migration and the traps in this codebase. To add a product feature, follow
[docs/aggregates.md](docs/aggregates.md): it walks through every file of the notes aggregate, in
order.

## Built by

I'm [Anton Shubin](https://antonshubin.com), a senior full-stack engineer and tech lead. This
template is the foundation I build client SaaS MVPs on. Need an MVP built for your product?
[That's my day job →](https://antonshubin.com/catalog/zero-to-production-saas-mvp)

Licensed under [MIT](LICENSE). Copyright (c) 2026 Anton Shubin.

---

Made by Anton Shubin · [antonshubin.com/tools](https://antonshubin.com/tools)
