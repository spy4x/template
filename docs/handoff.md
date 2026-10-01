# Handoff: Deno platform template

> Written 2026-08-19 for whoever picks this up next, human or AI. It describes the
> state of `main`, the decisions already made and why, the traps this codebase
> has, and what to do next. Read [ADR 001](decisions/001-deno-platform-template.md)
> and [ADR 002](decisions/002-realtime-transport-and-sync.md) first - they are
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

## State of main

Green: `deno task check` (110 tests in six runs), `deno task test:integration` (29 tests, 58
steps, needs Postgres), `deno task spa:build`, `deno task mpa:check`, and the Playwright e2e suite
(9 tests).

```
apps/api      REST, the /api/ws socket, auth, CQRS dispatch. The only app with real behaviour.
apps/spa      Preact + Vite PWA. Wires the libs/ui auth, profile and groups screens;
              group commands and queries go over the socket.
apps/mpa      Fresh. REST-only, server-rendered client: auth, profile, groups and notes,
              every action a form post that works without JavaScript. Calls the API
              over HTTP (API_URL); in compose under the `mpa` profile.
apps/worker   Drains outbox_events and announces group changes (pg_notify); sweeps
              expired idempotency keys; runs delayed and repeating jobs (below). Runs in compose
              as `worker`, from the API's image.

libs/platform  empty. Its primitives come from spy4x/ts-libs on JSR:
               @spy4x/validation, @spy4x/platform/{cqrs,cache,api,model,
               request-info,tokens}.
libs/domain    groups (enums, policy, commands/queries), identity (user, session,
               auth). May depend on platform only.
libs/server    db (migrations and schema.sql only), groups (Postgres repository,
               cursor, change notification). Database access, outbox, key-value store, config,
               request logging, sign-in and auth come from @spy4x/server/*.
libs/client    vite. Icons, useUrlFilters and the signed-in Shell come from
               @spy4x/preact-icons, @spy4x/preact-signals and @spy4x/preact-system.
libs/ui        Product screens shared by the SPA and the MPA (alias @ui/): auth,
               profile and the two frames. Props in, callbacks out; see AGENTS.md.
```

What genuinely works end to end: sign-up creates the auth user and password key
(`@spy4x/server` auth tables), the `users` profile row, the personal group and
the session in one transaction; `GET/POST /api/groups` with MFA-aware auth, CSRF
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
- **Session strength is checked on the buses, not in a transport.** Every
  command and query carries an `Actor` (`libs/domain/identity`), which a
  transport builds from its session (`apps/api/cqrs/actor.ts`). The session gate
  (`apps/api/cqrs/session-gate.ts`) is attached to both bus singletons where they
  are built (`apps/api/services/commandBus.ts` and `queryBus.ts`), and refuses a
  message whose session still owes a second factor. It denies by default: a
  message without an actor is refused unless it is listed as anonymous in
  `session-gate.ts`. A new transport gets the check by dispatching
  through the buses; it must not add its own. An `Actor` is a snapshot of the
  session: a long-lived transport such as the WebSocket must re-validate the
  session instead of trusting an actor it built at upgrade.
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
| `docs/woodpecker-ci-setup.md`                       | Current. `.woodpecker/ci.yml` runs check, build, integration and e2e on every pull request and push to `main`                        |
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
6. **`apps/api`'s cache keys gained an `api:` prefix (PR #21).** `RedisKvStore`
   scopes every key it writes under a mandatory prefix; the app's old kv client
   wrote unprefixed keys (`user_123`, `userSession_...`, etc). Rolling back to a
   commit before that PR makes the app read those old unprefixed keys again.
   Only `userSession_*` matters here: it caches the session row itself, so a
   stale unprefixed entry for a session a user has since signed out of - under
   the prefixed version, which never touched that old key - makes the rollback
   read it as still active and the session comes back to life. Stale
   `isSessionTokenExpired_*` entries do not have this effect: that cache only
   ever holds `true`, to short-circuit a token already known to be expired, so
   a stale or missing entry there can only cause an extra DB check or a false
   "expired", never revive a session. **Flush Valkey before rolling back past
   this commit.** The forward direction has a matching one-time step: on the
   first deploy of this PR, delete every Valkey key that does not match
   `api:*`:
   ```sh
   valkey-cli --scan | grep -v '^api:' | xargs -r valkey-cli del
   ```
   The stale unprefixed keys expire on their own TTL regardless, but deleting
   them up front removes any chance of the same rollback problem recurring if
   a later rollback-then-roll-forward cycle skips this step.
7. **Sign-in moved to the `@spy4x/server` auth tables (migration
   `2026_09_24_0001_auth_package_tables.sql`).** Deploying it signs every
   existing user out for good: `user_keys` and `user_sessions` are dropped, so
   every password hash, session and authenticator-app secret is gone, and every
   `users.mfa` is reset to not configured. Each `users` row is kept (profile,
   groups, audit rows) under an `auth_users` row with the same id, but nothing
   can sign in to it any more; signing up again with the same username creates
   a new user. New password hashes are PBKDF2-SHA-256 at 600 000 iterations with
   the pepper as an HMAC key, and the session cookie value has a new format.
   `AUTH_PEPPER` and `AUTH_COOKIE_SECRET` must now be at least 32 characters, or
   the API refuses to start (`openssl rand -hex 32`). `AUTH_TOTP` is no longer
   read, but config still requires it (a follow-up removes it). Sessions are no
   longer cached in Valkey, so the `userSession_*` and `isSessionTokenExpired_*`
   keys of trap 6 are never written again. Rolling back past this migration
   needs a database restore: the old tables are gone. **Deploy step:** the
   migration resets `users.mfa` in SQL only, and the API cached `users` rows in
   Valkey for 30 days (`api:user_<id>`). Since the second factor and role are read
   from Postgres (#97) a stale entry only affects the profile display; delete those
   keys once, right after the migration runs, to clear it:
   ```sh
   valkey-cli --scan --pattern 'api:user_*' | xargs -r valkey-cli del
   ```

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

Compose, and so `deno task deploy`, applies migrations itself: the one-shot `migrate` service runs
`deno task db:migrate` on every `up`, and the API and the worker start only after it exits with 0.
There is no manual migration step in production. A failed migration fails `compose up` and leaves
the new API and worker created but not started; fix the migration and deploy again.

To run the API for real outside compose you also need Valkey (`valkey-server --requirepass
<KV_PASSWORD>`; the API refuses to start without `KV_PASSWORD` and sends it with `AUTH`),
migrations applied (`deno task db:migrate`), and `infra/configs/vapid.json` present
(`deno task vapid-key:create`) copied to `./vapid.json`, since the API reads it
from the working directory while compose bind-mounts it. Compose fails the start when the file is
missing; `deno task deploy` generates it on the server.

Live updates between tabs need the worker too: without it a group created in one tab shows in
another only after a reconnect or a reload, and the e2e test "a group created in one tab appears in
the other tab without a reload or reconnect" fails. Compose runs it as `worker`; outside compose,
start it with `deno run --allow-sys -E -N apps/worker/+main.ts` and the API's `DB_*` values.

## What is not built yet

- `authorization_revision` exists as a column on `groups` and is **never incremented**.
- Only the group and note calls go over the socket. The profile, password, two-factor and
  push calls are still REST, and the profile page no longer receives live updates (a profile change
  in another tab shows after a reload).
- Group membership cannot be changed through the product: tests seed a second member with `POST /api/test/add-member`.
- No local projection in the SPA, no offline outbox, no conflict UI. The page keeps its cursors in
  `localStorage` and rereads the whole group list to catch up.
- The worker publishes a group change with `pg_notify`, which reaches only API instances that are
  listening at that moment. A push missed that way is caught by the pull after the next reconnect.

## How a group call travels

1. `apps/spa/src/state/realtime.ts` opens `/api/ws`. The upgrade runs the same session gate as
   REST and the `Origin` check, then `apps/api/services/realtime.ts` remembers which session each
   socket belongs to.
2. `group.create`, `group.list` and `group.get` are dispatched on the same command and query buses REST uses,
   from `apps/api/features/groups/socket.ts`. Each frame reads the session again from the database,
   so a signed-out or expired session is refused. Authorization stays in the buses.
3. A command needs an idempotency key. `@spy4x/server/idempotency` (ts-libs) stores it for 7 days
   per user and runs the command once; a repeat returns the first result, and a repeat while the
   first still runs waits, then answers `conflict`. The worker sweeps expired keys hourly.
4. Every committed group change bumps `groups.next_change_sequence` and writes an outbox row in
   the same transaction. The worker drains the outbox and sends `pg_notify`; the API turns it into
   a `change.hint` with the sequence for every member's open sockets.
5. A job is an outbox row with `aggregate_type = 'job'`, no group and no payload, claimed once its
   `available_at` has come. `scheduleOutboxEvent` (from `@spy4x/server/outbox`) writes one, in the
   transaction of the change that needs it. Add a handler to the `JobPublisher` in
   `libs/server/jobs/wiring.ts`; it reads what it needs from the database. A failing job backs off
   (1 s, 2 s, 4 s, up to 5 minutes) and after 10 attempts stops with its error in
   `last_error_code`. A repeating job is listed in `repeatEveryMs`: a successful run writes the
   next one. The worker starts one, `outbox.cleanup`, at 03:00 UTC and then daily: it removes
   outbox rows processed more than 7 days ago. A job that gave up stays unprocessed, so the
   worker does not restart it; look for rows with `last_error_code` set.
6. A listener on the in-process event bus that throws is isolated, logged as one JSON line with the
   event and listener names and the request id, and counted in `event_listener_failures_total`
   (`apps/api/services/metrics.ts`). Register listeners with `subscribe` (not `eventBus.on`) so the
   name is known, and mark each best-effort or durable in `apps/api/cqrs/+init.ts`. Nothing exports
   the counter yet; the scrape endpoint and the alert rule are #159. An outbox row has no payload,
   so a listener that needs the event's data cannot be durable until it has one.
7. The SPA treats a hint as a reason to read. The read is `GET /api/groups`, the same one it makes
   at start-up and after every reconnect, so a lost frame costs one read.

## Next steps, in dependency order

Each is intended to be one small PR. Small PRs are an explicit requirement here.

1. **Increment `authorization_revision`** on membership and role changes.
2. **Move the profile, password, two-factor and push calls to the socket**, with live profile and
   push-device updates.
3. **SPA local projection and offline outbox.**

Extraction from the sibling Financy project is tracked separately in
[docs/financy-extraction-inventory.md](financy-extraction-inventory.md);
delete rows there as they land.

## Working agreements

- Small, focused PRs. The first one was 277 files and that was too big to review.
- Verify before claiming. Run the gates, and run the app when the change touches
  runtime behaviour.
- State facts from the code, not from memory. Both sibling projects were read
  before being described, and both turned out to differ from their own docs.
