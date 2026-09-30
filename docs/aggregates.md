# Adding an aggregate

An aggregate is one kind of thing a product keeps, such as a note, an invoice or a task. This page
lists every file a new aggregate needs, in the order to write them, using **notes** as the worked
example. Copy the notes files, rename them, and change the fields and rules; do not invent a second
shape.

Notes are the reference because they touch every layer and hold no product rules: a note belongs to
one group, has a title, a body, who created and last changed it, and a version. Every member of the
group reads notes; an editor or above writes them.

## The rules every aggregate follows

- **It lives inside a group.** Groups are the only tenancy boundary, so every row carries a
  `group_id` and every check starts from the actor's membership of that group.
- **Authorization is in the handlers.** The REST route and the socket only parse and dispatch. The
  handler reads the actor's role and refuses before it touches anything, so both transports get the
  same answer from the same code (ADR 002, "Authentication, authorization, revocation").
- **Every write moves the group's change sequence** and writes an outbox row, in the same
  transaction as the write. The worker turns the outbox row into a hint on every member's socket,
  and their pages read again. Nothing else is needed for live updates.
- **Every command carries an idempotency key** over the socket, and **every update and delete names
  the version it saw**. A stale version is refused with a typed conflict that carries the current
  version, instead of overwriting a change the client never saw.
- **Screens are dumb and work without JavaScript** (see "Three layers of UI" in `AGENTS.md`).

## The files, in order

### 1. Domain: `libs/domain/notes/`

| File        | What it holds                                                                                                                                                                                                                                                                                                                                                       |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `+lib.ts`   | The `Note` shape; the arktype request schemas (the REST bodies, which are also the form field names, and the socket payloads); `NoteError` and `NoteVersionConflictError`; the commands (`NoteCreateCommand`, `NoteUpdateCommand`, `NoteDeleteCommand`) and queries (`NoteListQuery`, `NoteGetQuery`); the outbox event kinds; the authorization rule; the `NoteRepository` port. |
| `+lib.test.ts` | The schemas and the authorization rule.                                                                                                                                                                                                                                                                                                                         |
| `deno.json` | Makes it a workspace member.                                                                                                                                                                                                                                                                                                                                        |

Then register it in the root `deno.jsonc`: the `workspace` array (or its tests never run,
`docs/handoff.md` trap 1) and an `@domain/notes` import alias. Add its `deno.json` to the `COPY`
lines of `Dockerfile.base`; `tests/dockerfile-base.test.ts` fails until you do.

The authorization rule is two functions, `assertCanReadNotes(role)` and
`assertCanWriteNotes(role)`. A person who is not a member gets `GROUP_NOT_FOUND`, never "forbidden",
so a stranger cannot learn that a group exists.

### 2. Database: `libs/server/db/`

| File                                    | What it holds                                                                                                                                                                                  |
| --------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `migrations/2026_10_02_0001_notes.sql`  | The `notes` table: `group_id`, the fields, `version`, `change_sequence` (the group sequence the note was last written at), who created and updated it, and `deleted_at` (a delete keeps the row). |
| `schema.sql`                            | The same table appended, so the snapshot matches the migrations.                                                                                                                                |

Add the table to `SNAPSHOT_TABLES` and apply the migration in
`tests/integration/groups.integration.test.ts`, which compares the two. Compose applies migrations
on every start; nothing else is needed to deploy one.

### 3. Repository: `libs/server/notes/`

| File                           | What it holds                                                                                                                                                                                                  |
| ------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `postgres-note-repository.ts`  | Reads and writes. Each write runs in a transaction that calls `recordGroupChange` (`libs/server/groups/group-change-log.ts`), which moves the group's sequence and writes the outbox row. It checks no role. |
| `note-list-cursor.ts`          | The signed paging cursor, bound to the user and the group, so a cursor cannot be replayed by someone else or on another group.                                                                                  |
| `deno.json`                    | Workspace member; register it and add an `@server/notes/` alias like the domain.                                                                                                                                |

The version check is the `WHERE version = ${expected}` of the `UPDATE`. When no row matches, the
repository reads the note once more to tell "gone" (`NOTE_NOT_FOUND`) from "moved on"
(`NoteVersionConflictError` with the current version). A create retried with the same id and the
same content returns the first note instead of failing.

Expose it on `AppDbBase` in `apps/api/services/db-base.ts` as a getter built per access, like
`group` (trap 5: a cached repository escapes the transaction).

### 4. Handlers: `apps/api/features/notes/handlers.ts` and `apps/api/cqrs/`

`handlers.ts` holds one factory per command and query. Each reads the actor's role in the group,
runs the authorization rule, then calls the repository. The session gate on both buses has already
checked the session's strength.

`apps/api/cqrs/note-dependencies.ts` wires the handlers to `db.note` and to the membership read
(`db.group.getForMember`, always from Postgres). One file per handler under
`cqrs/command-handlers/` and `cqrs/query-handlers/` builds it, and `cqrs/+init.ts` registers it on
the bus. The idempotency middleware on the command bus needs nothing from you: a command whose data
carries an `idempotencyKey` runs once per user and key.

### 5. Transports: the socket for the SPA, REST for the MPA

| File                                        | What it holds                                                                                                                                     |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/api/features/notes/list.ts`           | One page of the list, with its cursor. Both transports call it, so they cannot drift apart.                                                       |
| `apps/api/features/notes/socket.ts`         | The socket requests `note.create`, `note.update`, `note.delete` (commands) and `note.list`, `note.get` (queries): parse the payload, dispatch.    |
| `apps/api/features/notes/errors.ts`         | REST error codes and statuses. A version conflict answers 409 with `currentVersion`.                                                               |
| `apps/api/routes/notes.ts`                  | `GET`, `POST`, `PATCH`, `DELETE` under `/api/groups/:groupId/notes`, with the same-origin guard on writes and an optional `Idempotency-Key` header. |
| `apps/api/services/note-list-cursor.ts`     | The cursor codec, keyed from the cookie secret.                                                                                                   |

Then wire them: mount the route in `apps/api/index.ts` (before `/groups`), add the socket requests
to the `Realtime` in `apps/api/services/realtimeHub.ts`, and map `NoteError` in `toRequestError`
(`apps/api/services/realtime.ts`), so the client gets `forbidden`, `not_found` or `conflict` with
the domain code (and the current version) in `details`.

The worker needs no change. A note's outbox row names the group as its aggregate and the group's
sequence as its version, so it is announced exactly like a group change.

### 6. Screen: `libs/ui/`

| File                 | What it holds                                                                                                                                                                         |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `progressive.tsx`    | `NOTE_PATHS`: the routes the forms post to and the pages link to, built from the ids.                                                                                                  |
| `notes-screen.tsx`   | `NotesScreen`: props in, callbacks out. The create and edit forms post the API's field names; delete is a form with the version; "Edit" is a link. A viewer gets the list and no form. |
| `screens.test.tsx`   | Renders the screen on the server and checks that every action is a working form or link whose fields match the request schema.                                                         |

### 7. SPA wiring: `apps/spa/src/`

| File                      | What it holds                                                                                                                                                                  |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `state/notes.ts`          | The store: reads a group's notes over REST, writes over the socket with `realtimeCommand` (which adds the idempotency key), and turns a version conflict into the conflict UI. |
| `state/notes.test.ts`     | The store against fake calls.                                                                                                                                                  |
| `views/NotesView.tsx`     | Passes the store and the group's role to `NotesScreen`.                                                                                                                        |
| `app.tsx`                 | The routes, and the pull: a hint for the open group reads its notes again.                                                                                                     |

The store does not move the group's cursor on its own writes: another member's change may have
taken the sequence just before, and moving past it would drop that change's hint. Its own hint costs
one extra read instead.

### 8. Tests

| File                                                        | What it proves                                                                                        |
| ----------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `apps/api/features/notes/transports.test.ts`                | Both transports on real buses and handlers: a viewer's writes are refused; a stale version conflicts. |
| `apps/api/features/notes/socket.test.ts`, `routes/notes.test.ts` | Parsing and dispatch of each transport.                                                          |
| `tests/integration/notes.integration.test.ts`               | Postgres: one sequence step and one outbox row per write, conflicts, viewers, paging.                 |
| `e2e/notes.e2e.ts`                                          | Two members: one creates, edits and deletes; the other's open tab follows without a reload.           |

The product cannot add a member yet, so tests seed one: the integration test inserts the row, and
the e2e spec calls `POST /api/test/add-member` (`apps/api/routes/dev.ts`, mounted only in
development). Teach `POST /api/test/cleanup-user` to delete the new table's rows too.

## What is left to the next aggregate

- The MPA pages that post to `NOTE_PATHS` are not built yet
  ([#82](https://github.com/spy4x/template/issues/82)).
- The role check and the write are two steps, not one transaction. Membership cannot change
  through the product yet; when it can, the check moves into the write's transaction.
- The SPA reads the whole list again on every hint. A pull of only the notes changed after the
  cursor needs the `change_sequence` column, which is already there, and a query that uses it.
