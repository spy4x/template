# Handoff: Deno platform template

> Written 2026-08-19 for whoever picks this up next, human or AI. It describes the
> state of `master`, the decisions already made and why, the traps this codebase
> has, and what to do next. Read [ADR 001](docs/decisions/001-deno-platform-template.md)
> and [ADR 002](docs/decisions/002-realtime-transport-and-sync.md) first - they are
> authoritative and this file is not.

## What this repository is

A reusable Deno platform template. **The reusability is the product.** Nothing here
is a shipping application; the goal is a baseline that new projects are generated
from, so anything product-specific is a defect rather than a feature.

Distribution is staged: Git template first, JSR packages for libraries once proven
across real projects, a CLI last.

## Ground rules

- **Deno only.** No `node`, `npm`, `pnpm`, `yarn` or `bun` commands. Selected
  `npm:` specifiers are fine where Vite, Preact or Dexie need them - they still
  run through Deno.
- Enums start at 1, never 0.
- Money is integers.
- `BIGINT` crosses JSON as a decimal string (`::text` in SQL), because
  `Number.MAX_SAFE_INTEGER` is smaller than a Postgres bigint.
- Tenancy has exactly one boundary: the **group** (`PERSONAL = 1`, `SHARED = 2`).
  Roles are `VIEWER = 1`, `EDITOR = 2`, `ADMIN = 3`, `OWNER = 4`.
- Postgres is authoritative. The browser's local store is a disposable projection
  and never resolves a conflict.

## State of master

Green: `deno task check` (30 tests, 59 steps), `deno task test:integration`
(3 suites, 14 steps, needs Postgres), `deno task spa:build`, `deno task mpa:check`.

```
apps/api      REST, auth, CQRS dispatch. The only app with real behaviour.
apps/spa      Preact + Vite PWA. Auth and profile UI only.
apps/mpa      Fresh. SSR shell plus /health. No features yet.
apps/worker   Drains outbox_events. Real, small.

libs/platform  cqrs (buses), types (validation, API envelopes, push contracts),
               cache, helpers. Depends on nothing but arktype and std.
libs/domain    groups (enums, policy, commands/queries), identity (user, session,
               auth, ws payload contracts). May depend on platform only.
libs/server    db, groups (Postgres repository, cursor), outbox, crypto, kv,
               helpers.
libs/client    browser, preact, vite, icons, helpers.
```

What genuinely works end to end: sign-up creates user, key, personal group and
session in one transaction; `GET/POST /api/groups` with MFA-aware auth, CSRF
guard and signed keyset pagination; the worker claims and publishes outbox rows.

## What is decided (and must not be quietly re-litigated)

ADR 002 is recent and reverses part of ADR 001. In short:

- `apps/spa` speaks **WebSocket** for mutations, queries and realtime. It uses
  REST only for bootstrap and the auth endpoints that must exist before a socket
  can open.
- `apps/mpa` speaks **REST only**, request/response, no realtime. Being strictly
  synchronous is what makes it a distinct reference architecture.
- Both are thin adapters over **one set of CQRS handlers**. A transport parses,
  authenticates and dispatches; it holds no business rule.
- **Push with sequence, pull as the authority.** A pushed change carries the
  sequence it was committed at. The client applies it only if that sequence is
  contiguous with its cursor; on any gap it discards the payload and pulls.
- The governing test: **delete every line of WebSocket code and the app must
  still converge to correct state.**
- Bootstrap is REST for both apps.
- Idempotency key on every command, expected version on updates, keys kept 7 days.
- `Origin` is validated at the WebSocket upgrade. Handshakes are not governed by
  CORS, and `SameSite=Lax` still admits a same-site subdomain.
- Live sockets are re-evaluated on sign-out, session expiry and
  `authorization_revision` change.

## Which documents to trust

Documentation drifts here, so check status before believing anything.

| Document                                            | Status                                                                                                                               |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `docs/decisions/001-deno-platform-template.md`      | Authoritative, except transport and sync rules, which ADR 002 replaced                                                               |
| `docs/decisions/002-realtime-transport-and-sync.md` | Authoritative. Most recent decision                                                                                                  |
| `docs/design/group-sync.md`                         | Superseded in part. Its change log, cursor, idempotency and conflict rules still stand; its "WebSocket is optional" framing does not |
| `docs/prd/group-sync-platform.md`                   | Superseded in part. Read "REST" as "through the shared CQRS handlers"                                                                |
| `docs/stack.md`                                     | Current. What is actually running and deployed                                                                                       |
| `docs/principles.md`                                | Current, general                                                                                                                     |
| `docs/woodpecker-ci-setup.md`                       | Aspirational. No pipeline is wired up                                                                                                |
| `docs/financy-extraction-inventory.md`              | Working list. Delete rows as they land, delete the file when drained                                                                 |

A new ADR supersedes rather than rewrites: ADR 001 keeps its text and carries a
pointer. Do not edit accepted decisions in place.

## Traps in this codebase

These cost real time to find. Do not rediscover them.

1. **Deno workspace test discovery.** `deno test <dir>` only collects from
   workspace _members_ once the directory contains any. Moving tests under
   `libs/platform` silently dropped 10 of 20 tests, with the step count unchanged
   so it looked fine. Every lib holding tests is registered in the `workspace`
   array in `deno.jsonc`; add new ones there or their tests will not run.
2. **`deno fmt` from the repo root, always.** Running it inside a member
   directory picks up that member's `deno.json`, which has no `fmt` block, so it
   formats with defaults and adds semicolons that root `fmt --check` then rejects.
3. **Postgres readiness must be checked over TCP.** The postgres image runs a
   temporary unix-socket-only server during initdb. `pg_isready` without `-h`
   reports ready against that one, tests connect, the temporary server shuts
   down, and everything fails with `ConnectionReset` at random. See the recipe
   below.
4. **`.git` is inside a Syncthing folder shared across several machines.**
   `.stignore` excludes only `node_modules` and `.volumes`. Absolute paths in
   worktree pointers do not survive the hop between machines, so a worktree can
   look missing or `prunable` when nothing is wrong - run `git worktree repair`
   rather than assuming lost work. Concurrent git operations on two machines can
   corrupt objects; prefer the remote as the sync channel.
5. **`DbService.group` is constructed per access on purpose.** `begin()` derives
   the transactional service with `Object.create(this)` and rebinds `sql`, so
   caching the repository would silently escape the transaction.

## Running it

```sh
deno task check            # fmt, lint, types, unit tests
deno task spa:build
deno task mpa:check
deno task dev              # compose up
```

Integration tests need a throwaway Postgres:

```bash
NAME="template-test-$$"
PASS=$(openssl rand -hex 24)
docker run -d --name "$NAME" -e POSTGRES_USER=tester -e POSTGRES_PASSWORD="$PASS" \
  -e POSTGRES_DB=template_test -p 127.0.0.1::5432 postgres:16-alpine
PORT=$(docker port "$NAME" 5432/tcp | cut -d: -f2)

# Wait over TCP, not the unix socket - see trap 3 above.
timeout 90 docker exec "$NAME" sh -c \
  'until pg_isready -h 127.0.0.1 -U tester -d template_test -q; do sleep 0.5; done'

DB_HOST=127.0.0.1 DB_PORT="$PORT" DB_USER=tester DB_PASS="$PASS" DB_NAME=template_test \
  deno task test:integration
docker rm -f "$NAME"
```

To run the API for real you also need Valkey, migrations applied
(`deno task db:migrate`), and `infra/configs/vapid.json` present
(`deno task vapid-key:create`) copied to `./vapid.json`, since the API reads it
from the working directory while compose bind-mounts it.

## What is not built yet

The sync protocol is designed and not implemented. Specifically:

- `next_change_sequence` and `authorization_revision` exist as columns on
  `groups` and are **never incremented**. No cursor exists yet.
- There is no change log, so nothing can be replayed in order.
- `outbox_events` is drained by the worker, but the publisher only logs. Nothing
  consumes the events.
- No bootstrap or pull endpoint.
- No WebSocket transport beyond the existing profile socket.
- No local projection in the SPA, no offline outbox, no conflict UI.
- No idempotency key store.

## Next steps, in dependency order

Each is intended to be one small PR. Small PRs are an explicit requirement here.

1. **Increment `next_change_sequence`** on every committed group-scoped change
   and record changes so they can be replayed in order. Everything else depends
   on this; without it there is no cursor.
2. **Increment `authorization_revision`** on membership and role changes.
3. **Idempotency key store** with a 7-day sweep.
4. **Bootstrap and pull REST endpoints** over the change log.
5. **`libs/server/realtime`** - connection registry, `Origin` validation at
   upgrade, sequence-stamped push, sign-out fan-out. Mounted by `apps/api`; keep
   it behind a library boundary so it can move to `apps/realtime` later without a
   rewrite.
6. **A notes example aggregate**, to prove the protocol end to end on something
   other than groups.
7. **SPA local projection and offline outbox.**
8. **Deterministic Playwright e2e** for offline to reconnect.

Also open and unresolved: authorization currently lives in `apps/api` route
middleware, which the WebSocket transport will bypass. That has to be solved
before step 5, and the approach is still under discussion - see the open PR.

Extraction from the sibling Financy project is tracked separately in
[docs/financy-extraction-inventory.md](docs/financy-extraction-inventory.md);
delete rows there as they land.

## Working agreements

- Small, focused PRs. The first one was 277 files and that was too big to review.
- Verify before claiming. Run the gates, and run the app when the change touches
  runtime behaviour.
- State facts from the code, not from memory. Both sibling projects were read
  before being described, and both turned out to differ from their own docs.
