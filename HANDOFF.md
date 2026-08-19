# Handoff: Group Foundation Slice

> Generated 2026-08-19. TLDR for resuming work in this worktree.

## Where Are We

**Worktree:** `/home/spy4x/sync/code/worktrees/template/refactor/platform-template`
**Branch:** `refactor/platform-template`
**Base:** `feature/github-app-oauth` (NOT `master`)
**PR #4:** https://github.com/spy4x/template/pull/4

We are implementing the **group foundation** — the first slice of the group-scoped offline-first sync architecture. This slice delivers: group persistence, shared-group create/list with bounded pagination, CQRS wiring, signup atomicity (user+key+personal-group+session), CSRF protection, audit/outbox tables, and extensive integration tests.

## Current State

### Green

- `deno task check`: ✅ 20 tests, 48 steps, all pass (lint+fmt+ts+test)
- `deno task test:integration`: ✅ 2 suites, 9 steps, all pass (disposable Postgres)
- `deno task spa:build`: ✅
- `deno task mpa:check`: ✅
- **No commit yet** — all work is uncommitted in the worktree

### Uncommitted Changes (14 modified + 21 new files, ~2600 lines)

**New files:**

- `libs/domain/groups/+lib.ts` (220L) — pure enums, interfaces, validation, policy
- `libs/domain/groups/+lib.test.ts` (107L) — domain unit tests
- `libs/domain/groups/deno.json` — workspace member config
- `libs/server/groups/postgres-group-repository.ts` (378L) — membership-scoped Postgres queries
- `libs/server/groups/group-list-cursor.ts` (103L) — signed, user-bound keyset cursor
- `libs/server/db/migrations/2026_08_18_0001_group_core.sql` (157L) — DDL
- `libs/server/db/migrations/2026_08_18_0002_personal_group_backfill.sql` (46L) — rerunnable backfill
- `apps/api/features/groups/handlers.ts` (20L) — CQRS command/query handlers
- `apps/api/features/groups/errors.ts` (55L) — typed error mapping
- `apps/api/routes/groups.ts` (100L) — REST list/create with MFA + same-origin guard
- `apps/api/middlewares/same-origin.ts` — CSRF middleware
- `apps/api/services/auth/password-signup.ts` (140L) — atomic signup transaction
- `apps/api/cqrs/command-handlers/group-create.ts` — CQRS wiring
- `apps/api/cqrs/query-handlers/group-list.ts` — CQRS wiring
- `tests/auth/password-signup.test.ts` (201L) — signup unit tests
- `tests/groups/handlers.test.ts` (82L) — handler unit tests
- `tests/groups/route.test.ts` (211L) — route unit tests
- `tests/groups/cursor.test.ts` (33L) — cursor unit tests
- `tests/integration/groups.integration.test.ts` (453L) — Postgres integration tests
- `tests/middlewares/same-origin.test.ts` (74L) — CSRF unit tests

**Modified files:**

- `deno.jsonc` — workspace members, imports, tasks
- `libs/server/db/schema.sql` — group tables in schema snapshot
- `libs/server/db/+index.integration.test.ts` — expanded transaction boundary tests
- `apps/api/index.ts` — route mounting
- `apps/api/services/db.ts` — DbService extensions
- `apps/api/services/auth/password.ts` — signup wiring personal group ID
- `apps/api/services/auth/+index.ts` — export additions
- `apps/api/services/auth/session.ts` — minor type fix
- `apps/api/middlewares/auth-guards.ts` — soft-delete rejection
- `apps/api/cqrs/+init.ts` — group command/query registration
- `apps/api/routes/groups.ts` — CSRF + pagination
- `Dockerfile.base` — group migration permissions
- `README.md` — workspace description update
- `docs/3.architecture.md` — workspace description update

## Reviewer Blockers — Status

Reviewer found 11 findings (6 blocker, 5 follow-up). Agent fix round resolved most. QA pass 2 found one test bug. Current status:

| #  | Finding                                        | Status                                                                 |
| -- | ---------------------------------------------- | ---------------------------------------------------------------------- |
| 1  | Signup TOCTOU — no DB unique constraint        | ✅ Fixed: `(kind, identification)` unique index + `23505` catch        |
| 2  | Migration rollout — backfill before deployment | ✅ Fixed: split DDL + rerunnable backfill + `ensurePersonal` self-heal |
| 3  | Group create missing audit/outbox              | ✅ Fixed: atomic audit + outbox writes in transaction                  |
| 4  | CSRF missing on cookie mutation                | ✅ Fixed: same-origin middleware on POST                               |
| 5  | Group list unbounded, no pagination            | ✅ Fixed: signed cursor, default 50, max 100                           |
| 6  | Soft-deleted user can create groups            | ✅ Fixed: `assertActiveUser` with `FOR UPDATE`                         |
| 7  | Test uses hand-shaped SQL not real signup      | ✅ Fixed: uses `persistPasswordSignup` with failure injection          |
| 8  | Single connection no concurrency testing       | ✅ Fixed: `Promise.all` with deferred gate                             |
| 9  | Postgres adapter in API app                    | ✅ Fixed: moved to `libs/server/groups/`                               |
| 10 | CQRS contracts in API app                      | ✅ Fixed: moved to `libs/domain/groups`                                |
| 11 | Snapshot parity trigger/function def drift     | ✅ Fixed: compares `pg_get_triggerdef` + `pg_get_functiondef`          |

## QA Issue — Fixed

Rollback test fixture username exceeded 50-char validator limit. Fixed by shortening to `rb-<step>-<8char-suffix>`. Integration tests fully green.

## Architecture Recap

### DDL (`libs/server/db/migrations/2026_08_18_0001_group_core.sql`)

- `groups` table: UUID PK, kind (1=personal, 2=shared), name, owner_user_id, authorization_revision, next_change_sequence, timestamps, soft delete
- `group_members` table: composite PK (group_id, user_id), role (1-4)
- Unique partial index: one active personal group per user
- PL/pgSQL functions: `assert_personal_group_membership`, `check_personal_group_membership_trigger`
- Deferred constraint triggers on groups + group_members for personal group invariant
- `audit_events` table: idempotent (group_id, event_kind) unique
- `outbox_events` table: idempotent (aggregate_type, aggregate_id, aggregate_version, event_kind) unique
- Pre-migration: `UPDATE user_keys SET identification = lower(btrim(identification))` + unique index

### Domain (`libs/domain/groups/+lib.ts`)

- Enums: `GroupKind.PERSONAL=1, GroupKind.SHARED=2`, `GroupRole.VIEWER=1..OWNER=4`
- Interfaces: `Group`, `GroupSummary`, `GroupAccess`, `GroupRepository`
- Commands/Queries: `GroupCreateCommand`, `GroupListQuery`
- Pure functions: `parseCreateSharedGroupRequest`, role policy matrix
- Cursor types: `GroupListPageKey`, `encode`/`decode` interfaces

### Repository (`libs/server/groups/postgres-group-repository.ts`)

- `listForUser`: membership-scoped, keyset pagination, user active check
- `getForMember`: single group access check
- `createShared`: atomic transaction with active user assertion, idempotent retry, audit+outbox
- `createPersonal`: insert + owner membership
- `ensurePersonal`: idempotent, handles concurrent creation race

### Auth Flow (`apps/api/services/auth/password-signup.ts`)

- Normalized username (trim+lower)
- Atomic transaction: user → key → personal-group → session
- Unique violation → returns null (existing account)
- Each step injectable for rollback testing

### Routes (`apps/api/routes/groups.ts`)

- `GET /api/groups` — authenticated, MFA required, bounded pagination
- `POST /api/groups` — authenticated, MFA required, same-origin guard, JSON content-type check

### Tests

- **Unit:** domain enums/policy, cursor encode/decode, handlers, routes, same-origin, password-signup
- **Integration:** migration rerunnable, schema snapshot parity, signup rollback, 20x concurrent signup, personal self-heal, concurrent exact/mismatched shared create, pagination/isolation, soft-delete rejection

## Known Follow-ups (Not Blockers)

1. **Audit/outbox tables are generic but no processor exists yet** — outbox table created, events written atomically, but nothing reads/processes them. Worker will consume later.
2. **Sync protocol not implemented yet** — manifest, bootstrap, push, pull endpoints still ahead.
3. **No SPA Dexie local projection yet** — client-side offline cache is next major slice.
4. **PR #4 base is `feature/github-app-oauth`** — needs eventual base branch decision (rebase to `master`?).
5. **Some stale references** to old modules (Telegram bot, exchange rate, Financy) may remain in docs/infra.

## Next Steps (Ordered)

### Immediate (Do Now)

1. **Commit + push** — clean atomic commit of group foundation slice
2. **Update PR #4 body** with current state

### Short Term

5. **Add sync protocol endpoints** — `POST /api/sync/push`, `GET /api/sync/pull`, manifest, bootstrap
6. **Add notes example aggregate** — prove sync end-to-end with one entity
7. **Implement SPA Dexie outbox** — client-side CQRS command queue
8. **Add Playwright e2e** for offline→reconnect flow

### Medium Term

9. **Outbox processor in worker** — consume outbox events, produce sync notifications
10. **WebSocket hint channel** — optional real-time push for faster sync
11. **CLI scaffolding** — `npx template-init` for new project generation
12. **JSR library packaging** — extract `libs/domain/groups` etc. to publishable packages

## Key Decisions (Why)

| Decision                           | Why                                                                 |
| ---------------------------------- | ------------------------------------------------------------------- |
| Single tenant boundary = group     | Eliminates workspace/group confusion; simpler mental model          |
| No Postgres RLS in v1              | App-layer auth easier to test/debug; RLS later for defense-in-depth |
| Signed cursor for pagination       | Prevents tampering, no server state needed, user-bound              |
| Generic audit+outbox tables        | Avoids per-aggregate table proliferation; event_kind for routing    |
| Atomic signup transaction          | All-or-nothing: no orphaned users/groups without sessions           |
| Domain enums start at 1            | Global convention; avoids falsy-0 bugs                              |
| Bigints as decimal strings in JSON | JS `Number.MAX_SAFE_INTEGER` = 2^53-1; Postgres BIGINT exceeds      |

## Environment Setup for Integration Tests

```bash
cd /home/spy4x/sync/code/worktrees/template/refactor/platform-template

NAME="template-groups-test-$$"
PASS=$(openssl rand -hex 24)
docker run -d --name "$NAME" -e POSTGRES_USER=tester -e POSTGRES_PASSWORD="$PASS" -e POSTGRES_DB=template_test -p 127.0.0.1::5432 postgres:16-alpine
# Wait for ready...
PORT=$(docker port "$NAME" 5432/tcp | cut -d: -f2)
DB_HOST=127.0.0.1 DB_PORT="$PORT" DB_USER=tester DB_PASS="$PASS" DB_NAME=template_test deno task test:integration
docker rm -f "$NAME"
```
