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
- **Screens are dumb: props in, callbacks out** (see "Three layers of UI" in `AGENTS.md`).

## The files, in order

### 1. Domain: `libs/domain/notes/`

| File           | What it holds                                                                                                                                                                                                                                                                                                                                                                                        |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `+lib.ts`      | The `Note` shape; the arktype request schemas (the REST bodies, which are also the form field names, and the socket payloads); `NoteError` and `NoteVersionConflictError`; the commands (`NoteCreateCommand`, `NoteUpdateCommand`, `NoteDeleteCommand`, `NoteMoveCommand`) and queries (`NoteListQuery`, `NoteGetQuery`); the outbox event kinds; the authorization rule; the `NoteRepository` port. |
| `+lib.test.ts` | The schemas and the authorization rule.                                                                                                                                                                                                                                                                                                                                                              |
| `deno.json`    | Makes it a workspace member.                                                                                                                                                                                                                                                                                                                                                                         |

Then register it in the root `deno.jsonc`: the `workspace` array (or its tests never run,
`docs/handoff.md` trap 1) and an `@domain/notes` import alias. Add its `deno.json` to the `COPY`
lines of `Dockerfile.base`; `tests/dockerfile-base.test.ts` fails until you do.

The authorization rule is two functions, `assertCanReadNotes(role)` and
`assertCanWriteNotes(role)`. A person who is not a member gets `GROUP_NOT_FOUND`, never "forbidden",
so a stranger cannot learn that a group exists.

### 2. Database: `libs/server/db/`

| File                                   | What it holds                                                                                                                                                                                     |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `migrations/2026_10_02_0001_notes.sql` | The `notes` table: `group_id`, the fields, `version`, `change_sequence` (the group sequence the note was last written at), who created and updated it, and `deleted_at` (a delete keeps the row). |
| `schema.sql`                           | The same table appended, so the snapshot matches the migrations.                                                                                                                                  |

Add the table to `SNAPSHOT_TABLES` and apply the migration in
`tests/integration/groups.integration.test.ts`, which compares the two. Compose applies migrations
on every start; nothing else is needed to deploy one.

### 3. Repository: `libs/server/notes/`

| File                          | What it holds                                                                                                                                                                                                |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `postgres-note-repository.ts` | Reads and writes. Each write runs in a transaction that calls `recordGroupChange` (`libs/server/groups/group-change-log.ts`), which moves the group's sequence and writes the outbox row. It checks no role. |
| `note-list-cursor.ts`         | The signed paging cursor, bound to the user and the group, so a cursor cannot be replayed by someone else or on another group.                                                                               |
| `deno.json`                   | Workspace member; register it and add an `@server/notes/` alias like the domain.                                                                                                                             |

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

### 5. Transports: the socket for the SPA, REST beside it

| File                                    | What it holds                                                                                                                                               |
| --------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/api/features/notes/list.ts`       | One page of the list, with its cursor. Both transports call it, so they cannot drift apart.                                                                 |
| `apps/api/features/notes/socket.ts`     | The socket requests `note.create`, `note.update`, `note.delete`, `note.move` (commands) and `note.list`, `note.get` (queries): parse the payload, dispatch. |
| `apps/api/features/notes/errors.ts`     | REST error codes and statuses. A version conflict answers 409 with `currentVersion`.                                                                        |
| `apps/api/routes/notes.ts`              | `GET`, `POST`, `PATCH`, `DELETE` under `/api/groups/:groupId/notes`, with the same-origin guard on writes and an optional `Idempotency-Key` header.         |
| `apps/api/services/note-list-cursor.ts` | The cursor codec, keyed from the cookie secret.                                                                                                             |

Then wire them: mount the route in `apps/api/index.ts` (before `/groups`), add the socket requests
to the `Realtime` in `apps/api/services/realtimeHub.ts`, and map `NoteError` in `toRequestError`
(`apps/api/services/realtime.ts`), so the client gets `forbidden`, `not_found` or `conflict` with
the domain code (and the current version) in `details`.

The worker needs no change. A note's outbox row names the group as its aggregate and the group's
sequence as its version, so it is announced exactly like a group change.

### 6. Screens: `libs/ui/`

An aggregate has two pages, a **list page** and an **editor page**, and each is one screen. Copy
both. The list page only reads and links; everything that writes happens on the editor page, which
has its own address, a back link to the list and room for a long text.

| File                     | What it holds                                                                                                                                                                                                                                                                                                                                                |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `progressive.tsx`        | `NOTE_PATHS`: the pages the screens link to: `/notes`, `/notes/new` and `/notes/:id`. They carry no group id: the SPA acts on the person's selected group (see "How a group call travels", item 8, in `docs/handoff.md`).                                                                                                                                    |
| `notes-screen.tsx`       | The list page, `NotesScreen`: props in, links and callbacks out. "New note" and each note's title are links; the only form is the move of selected notes. A viewer gets the list and no "New note".                                                                                                                                                          |
| `note-editor-screen.tsx` | The editor page, `NoteEditorScreen`, for `/notes/new` (no note yet) and `/notes/:id`. Its fields carry the API's field names; "Save" and "Cancel" are the form's own, and the app's callbacks take the submit. A viewer gets the note as text. A note that cannot be read is "Note not found". The version conflict link and message are part of the screen. |
| `screens.test.tsx`       | Renders the newsletter screens on the server and checks that every action is a working form or link whose fields match the request schema.                                                                                                                                                                                                                   |
| `interactions.test.tsx`  | Drives each screen in a browser DOM: typing, submitting through the callback, and the delete dialog.                                                                                                                                                                                                                                                         |

Deleting asks first. With the app's `onDelete`, "Delete" in the page's menu opens
preact-components' `ConfirmDialog`; without it, the menu has no delete.

**A note in another of the person's groups.** A note belongs to one group, and the pages work on the
person's selected group. A link must never change the selection (another site could switch a
person's group with one), so `/notes/:id` for a note outside the selected group is the "Note not
found" page, which tells the person to switch group. The group picker is the one way to switch.

### 7. SPA wiring: `apps/spa/src/`

| File                       | What it holds                                                                                                                                                                                                                               |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `state/notes.ts`           | The store: reads a group's notes over REST, writes over the socket with `realtimeCommand` (which adds the idempotency key), and turns a version conflict into the conflict UI.                                                              |
| `state/notes.test.ts`      | The store against fake calls.                                                                                                                                                                                                               |
| `views/NotesView.tsx`      | Passes the store and the group's role to `NotesScreen`.                                                                                                                                                                                     |
| `views/NoteEditorView.tsx` | Passes the store and the group's role to `NoteEditorScreen` for `/notes/new` and `/notes/:id`, with the offline conflict state above it.                                                                                                    |
| `views/spa-paths.ts`       | Lists the paths the router owns, for preact-components' `UnsavedGuard` in `NoteEditorView.tsx`, which asks before the person leaves the editor page with text that is not saved: on closing the tab, and on a click on any link in the app. |
| `app.tsx`                  | The routes, and the pull: a hint for the open group reads its notes again.                                                                                                                                                                  |

The store does not move the group's cursor on its own writes: another member's change may have
taken the sequence just before, and moving past it would drop that change's hint. Its own hint costs
one extra read instead.

### 8. Tests

| File                                                             | What it proves                                                                                                                                            |
| ---------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/api/features/notes/transports.test.ts`                     | Both transports on real buses and handlers: a viewer's writes are refused; a stale version conflicts.                                                     |
| `apps/api/features/notes/socket.test.ts`, `routes/notes.test.ts` | Parsing and dispatch of each transport.                                                                                                                   |
| `tests/integration/notes.integration.test.ts`                    | Postgres: one sequence step and one outbox row per write, conflicts, viewers, paging.                                                                     |
| `e2e/notes.e2e.ts`                                               | Two members: one creates, edits and deletes on the note pages; the other's open tab follows without a reload; a viewer sees a note without edit controls. |
| `e2e/notes-move.e2e.ts`                                          | Moving one note and ticked notes, with members of both groups watching.                                                                                   |
| `tests/integration/note-move-push.integration.test.ts`           | Members of both groups get a hint for a move; a stranger gets none.                                                                                       |

The product cannot add a member yet, so tests seed one: the integration test inserts the row, and
the e2e spec calls `POST /api/test/add-member` (`apps/api/routes/dev.ts`, mounted only in
development). Teach `POST /api/test/cleanup-user` to delete the new table's rows too.

## Making an aggregate movable

A note can move to another group (`NoteMoveCommand`). An aggregate becomes movable by following the
same steps; copy the notes files that mention `move`:

1. **Domain.** A request schema (`toGroupId` and 1 to `NOTE_MOVE_MAX` ids), a socket payload schema
   that adds `groupId` (the source), `parseNoteMoveRequest` (refuses repeats and a move into the
   same group with `SAME_GROUP`), the command, and `<kind>.moved_out` and `<kind>.moved_in` events.
2. **Repository.** One transaction that locks both groups in id order (so two opposite moves wait
   for each other instead of deadlocking), checks the actor's role on both locked membership rows,
   updates `group_id`, raises the version, refuses with `NOT_FOUND` and rolls back when any id is not
   in the source, counts the cap on the target, records one change per group (`moved_out` on the
   source, `moved_in` on the target) and writes one `audit_events` row per group. The id and the
   history stay: a move is an update, not a copy and a delete.
3. **Handler and gate.** The handler asks for edit rights in the source, then in the target. The
   entitlement gate judges the target group (`needsRoom` with `toGroupId`), so a move into a full
   group is refused, but only for someone who can write in the source too (its `judges` reads the
   source role through `roleIn`), so a viewer of the source gets 403, not 402; the repository counts all moved rows, the gate only reserves room for one.
4. **Transports.** `POST /move` (registered before `POST /`) and the socket command `<kind>.move`.
5. **Screens.** The list gets a tick box per row and one form posting `{ toGroupId, noteIds }`; the
   item page gets a form posting `{ toGroupId }`. Targets are the person's groups where they may
   write (`moveTargetsOf`).
6. **SPA and offline.** The store sends the command over the socket and never queues it. A queued
   write for a moved item becomes a conflict (`docs/offline.md`).
7. **Tests.** Both transports (viewer, stranger, same group, all-or-nothing, cap), Postgres (one
   sequence step and one audit row per group, rights in both groups, opposite moves), the hint for
   members of both groups (`tests/integration/note-move-push.integration.test.ts`), the screens and
   an e2e spec.
8. **Entities tied to their group.** Notes reference nothing, so a note moves alone. An aggregate
   whose rows point at other rows of the same group (in Financy, a transaction's account and
   category) must decide before it becomes movable: the references move with it in the same
   transaction, or the move is refused with a clear error when a reference would be left behind.
   Never move the row and leave its references in the old group.

Moving all of a group's data before the group is deleted is not built (spy4x/template#260); it
would call this command with every id of the group.

## Adding a setting to a group

A setting is a property of the group itself, such as its description, colour and emoji. It is not
a new aggregate: the group already has the table, the repository, the transports and the change
event. Follow the details command (`group.updateDetails`, spy4x/template#134) file by file.

1. **Migration.** One file in `libs/server/db/migrations/` adds the column, with a default or a
   nullable type so existing rows stay valid, and a `CHECK` for a limit the database can hold.
   Mirror the same lines in `libs/server/db/schema.sql`; `groups.integration.test.ts` compares the
   snapshot with the migrations. Tests that apply a hand-written list of migrations
   (`auth.integration.test.ts`, `valkey-outage.integration.test.ts`, `groups.integration.test.ts`,
   `db-group-transaction.integration.test.ts`)
   need the new file added.
2. **Domain.** Add the field to `Group` and `GroupSummary` in `libs/domain/groups/+lib.ts`, one
   parser per field that throws `GroupError` with `INVALID_REQUEST`, and a limit constant the screen
   can import. A colour is stored as a palette name and checked against `GROUP_COLORS`, never a hex
   value. Settings that change together share one command so one request is one audit row.
3. **Repository.** Add the column to the selects and to `toGroup` and `toSummary`. The write locks
   the member's row, checks the role, updates, then calls `audit()` and `recordChange()` in the
   same transaction. That outbox row is the change event.
4. **Command and handler.** The handler judges the role again (`assertCanEditDetails` reuses the
   rename rule), so REST and the socket enforce it alike. Register the command in
   `apps/api/cqrs/+init.ts`, `apps/api/index.ts` and `apps/api/services/realtimeHub.ts`.
5. **Transports.** A REST route (`PUT /api/groups/:groupId/details`) and the socket command
   (`group.updateDetails`), with the same bad-input and role tests as the other group commands.
6. **Screen.** An "Edit details" item in the settings menu opens a dialog; the form is never open
   by default. Hide the item when the role may not edit. New fields on `GroupRow`, `PickerGroup`
   and the SPA's `GroupItem` are optional, because the offline store may hold groups saved before
   the field existed.
7. **Other members.** Nothing to add: `recordChange()` makes the worker send a hint to every
   member's socket, and their pages read the group again. Test it with two pages and a count of
   page loads, as `e2e/groups-details.e2e.ts` does.

## What is left to the next aggregate

- The SPA creates a note in the group it shows, over the socket, so a note never lands in a group
  other than the one on screen.
- The role check and the write are two steps, not one transaction. Membership cannot change
  through the product yet; when it can, the check moves into the write's transaction.
- The SPA reads the whole list again on every hint. A pull of only the notes changed after the
  cursor needs the `change_sequence` column, which is already there, and a query that uses it.
