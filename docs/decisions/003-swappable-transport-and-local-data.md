# ADR 003: Swappable transport and local data

- Status: accepted
- Date: 2026-10-10
- Maintainer: architecture owners
- Location: `docs/decisions/003-swappable-transport-and-local-data.md`
- Amends: "Transport per app" and the first consequence about the socket in
  [ADR 002](002-realtime-transport-and-sync.md). Everything else in ADR 002 stands: push with
  sequence and pull as the authority, bootstrap over REST, authorization in the handlers,
  idempotency.

## In short

A product built on this template chooses two things, per app and where it matters per aggregate:
how the page talks to the server (HTTP alone, or HTTP plus a WebSocket), and what it keeps on the
device (nothing, a copy to read, or a copy to read plus a queue of writes). Each choice is a module
behind a port. A store never knows which module is behind its port, and removing either module
leaves a working app.

## Context

ADR 002 says the SPA "speaks WebSocket for all mutations, queries and realtime updates". That is
not what was built, and not what products need:

- Only note commands, `note.get`, group commands and the group selection travel over the socket.
  Members, invitations, notifications, activity, the profile page's forms, billing, API tokens and
  e-mail are plain REST.
- A page with the socket blocked cannot write a note at all, although the server can serve the same
  command over REST.
- The offline layer (`apps/spa/src/offline/notes-*.ts`) is written for notes. A second aggregate
  gets none of it: no local copy, no queue, no conflict screen.
- Some future products need no socket, and some need no local database. Today neither can be left
  out without editing the stores.

The owner's requirement, for the template: "construction bricks (modules) interchangeable as much
as possible". For this app: every screen reads from the device (fast, searchable and filterable
with no network, kept in step with the server), and only the writes that make sense offline are
queued.

What already exists and is kept: every store takes its calls as an injected `…Dependencies`
object; the server dispatches REST and socket requests on the same command and query buses;
`@spy4x/realtime` has the outbox, its IndexedDB store and the sync runner; `@spy4x/platform` has
`createDataCache`.

## Decision

### 1. Three ports on the client

A store is built from its dependencies, and the dependencies are built from at most three ports.

| Port           | What it does                                                        | Modules that fill it                                         |
| -------------- | ------------------------------------------------------------------- | ------------------------------------------------------------ |
| **Calls**      | `command(name, payload, { idempotencyKey })` and `query(name, payload)` | HTTP (always present), WebSocket (optional)                |
| **Changes**    | "something changed, read again", for a group or for the person      | timers and page events (always present), socket hints (optional) |
| **Local data** | a copy of the server's last answer, and optionally a queue of writes | none, read cache, read cache plus outbox                    |

**Calls.** A request is a name and a payload, the shape the socket already uses (`note.create`).
The HTTP module sends the same request to `POST /api/call/<name>` and reads the same answer, so
both modules throw the same errors (`RealtimeRequestError` with the server's code in `details`, and
`ConnectionLostError` when the server cannot be reached). A store, the outbox and the error
wording therefore work unchanged over either. The WebSocket module, when present, is preferred
while its socket is open and falls back to HTTP while it is not. A product may also pin one
aggregate to one module.

List pages and bootstrap stay plain `GET` routes with a cursor, as ADR 002 decided. They are reads
that both modules share; they are not part of the calls port.

**Changes.** The pull stays the one path that makes a page correct (ADR 002). What varies is only
what triggers it. Without the socket: the start, the browser coming back online, the tab becoming
visible, the page's own write, and a timer while the tab is visible (30 s by default; the sync
runner's `pollIntervalMs`). With the socket: all of those, plus a hint the moment a change commits.
The socket module adds latency, never correctness.

**Local data.** One of three levels per aggregate:

1. **Online only.** The store calls the server and keeps nothing.
2. **Offline-readable.** Every full read replaces the device's copy. A read that cannot reach the
   server answers from the copy. A screen shows the copy at once and replaces it when the server
   answers. Search and filters run over the list the store holds, so they work with no network.
3. **Offline-writable.** Level 2, plus the outbox: a write is saved on the device, shown at once,
   sent when the server is reachable, and shown as a conflict when the server refuses it.

A local copy is replaced as a whole by every full read, so it cannot drift. A delta pull from the
cursor is the later optimisation ADR 002 already allows for; it would sit behind the same port and
no store would change. The limit of full reads is the size of one list: 2 000 notes per group
today (20 pages of 100). A product past that adds the delta pull.

### 2. One place chooses the modules

`apps/spa/src/modules.ts` is the composition root: the only file that imports the WebSocket module
(`apps/spa/src/realtime/`) and the local-data module (`apps/spa/src/offline/`). It reads two
switches from the runtime configuration (`/config.json`): `realtime` and `offline`, both `true` in
this app. Stores import ports from `modules.ts`, never a module.

- A product that never wants a module deletes its folder and its lines in `modules.ts`. A guard
  test per module (the pattern of `tests/offline-removal.test.ts`) fails when any other file
  imports the folder.
- The switches are what the tests use: the e2e suite runs its core specs once with
  `realtime: false` (HTTP only) and once with `offline: false` (online only), by answering
  `/config.json` from the test. ADR 002's governing test thereby becomes a test that runs: **delete
  every line of WebSocket code and the application must still converge to correct state.**

With `realtime: false` the page writes, reads and converges over HTTP, a few seconds later than
with the socket. With `offline: false` nothing is written to IndexedDB, the service worker still
caches the app's own files, and every screen needs the network.

### 3. The server: one table of operations, two adapters

The API already has the table: `SocketRequests`, a map from a request name to
`{ kind, handle({ actor, requestId, payload, idempotencyKey, signal }) }`, where `handle` parses
the payload and dispatches on a bus. It is renamed `Operations` and both adapters read it:

- the socket adapter, as today;
- a new HTTP adapter, `POST /api/call/<name>`, behind the same session gate and `Origin` check as
  every REST route. A command without an `Idempotency-Key` header is refused, as on the socket.

An aggregate lists its operations once and is reachable over both transports. Authorization,
entitlements, idempotency and the change log stay in the gates and handlers on the buses, so
neither adapter can skip them. `apps/api/features/notes/transports.test.ts` already runs the same
scenarios through REST and the socket; it gains the call route, and each new aggregate copies it.

The resource routes that exist (`/api/groups/:id/notes` and the rest) stay: the list pages serve
every client, and the others serve the token API and `curl`. A new aggregate adds its list route
and its operations, and no hand-written REST route per command.

Aggregates that are REST-only today (members, invitations, notifications, activity, billing, API
tokens, e-mail, sessions) keep their routes. They already work without the socket, which is the
swap this ADR must guarantee. One moves into the table when it needs the socket or the outbox, not
before.

### 4. The level of every aggregate in this app

| Aggregate                         | Level                | Why                                                                                   |
| --------------------------------- | -------------------- | ------------------------------------------------------------------------------------- |
| Notes                             | 3, offline-writable  | The product's content: a person writes it anywhere. Moving and restoring stay online (two groups, or a server-side state the device cannot know). |
| Tags (#170)                       | 3, offline-writable  | Content too, and a note written offline must be able to take a tag created offline.   |
| Groups list                       | 2, offline-readable  | Needed to show anything. Create, rename, delete and restore change access for other people, so they need the server. |
| Selected group                    | 2, offline-readable  | Read to know which notes to show. Switching is a server setting shared by every device; offline switching is not built (see "Not decided here"). |
| Members                           | 2, offline-readable  | A list a person looks up. Roles, removal, leaving and transfer change access: online only. |
| Invitations                       | 2, offline-readable  | The same. Inviting sends mail; revoking is an access change.                           |
| Notifications                     | 2, offline-readable  | An inbox is read on the move. Marking as read is online; it is a convenience, not content. |
| Activity                          | 2, offline-readable  | A log is only read. The device keeps the pages the person has opened.                  |
| Profile                           | 2, offline-readable  | Shown on every page. Changes are account changes: online only.                         |
| Billing (plan and status)         | 2, offline-readable  | The plan decides what the screens offer. Checkout and the portal are the provider's pages. |
| API tokens, signed-in devices     | 2, offline-readable, marked with the time of the copy | The lists show with no network, but a stale security list must say it is stale. Creating, revoking and signing a device out are online only. |
| Password, e-mail change, two-factor set-up, account deletion, sign-in and sign-up | 1, online only | Security actions with nothing to list. The server must answer before anything changes. |
| Push devices                      | 1, online only       | Registration is a conversation between this browser and the server.                    |
| Newsletter (MPA)                  | none                 | The MPA has no session, no JavaScript requirement and no local data.                   |

The rule behind the table: **every list is kept on the device; only content is queued; anything
that changes who can see or do what needs the server's answer first.**

Signing out drops every local copy, as it does today for notes and groups. The outbox stays, as
`docs/offline.md` explains.

### 5. Offline-writable aggregates share one layer

Each offline-writable aggregate has its own queue (its own IndexedDB database per user) and
supplies an adapter: how an entry becomes a command, how an error reads, the conflict wording, and
how a queued entry looks in a list. The layer owns everything else: opening the stores, the lock
shared by every tab, the sync runner, the conflict screen and the status line.

Queues are sent in a declared order, parents first: tags, then notes. A note's tags travel inside
the note's own write as a list of tag ids, so one note has one queue entry, and a tag created
offline reaches the server before the note that uses it. If the tag's create is refused, the note's
write names a tag the server does not have and becomes a visible conflict, never a silent loss.

### 6. Where the code lives

Reusable code is written in the libraries first, released, then imported (the rule in
`AGENTS.md`). The template keeps only what names this app's aggregates.

| Piece                                                                                   | Home                                   |
| --------------------------------------------------------------------------------------- | -------------------------------------- |
| The calls port, retry with one idempotency key, "is this error worth a retry" (`apps/spa/src/state/realtime-call.ts` today) | `@spy4x/realtime` (new)   |
| The HTTP calls module for the client, and "prefer the socket, fall back to HTTP"        | `@spy4x/realtime` (new)                |
| The operations table type and the HTTP adapter for the server (web-standard `Request` in, `Response` out) | `@spy4x/realtime` (new)   |
| A read cache behind a list read: replace on answer, answer from the copy when unreachable, show the copy first | `@spy4x/realtime` on `createDataCache` (new) |
| An offline-writable collection: cache plus outbox plus the overlay of queued entries on a list, from one adapter; several collections flushed in order | `@spy4x/realtime` on `createOutbox` (new) |
| The outbox, its IndexedDB store, the sync runner, the data cache                        | ts-libs (exist)                        |
| `SyncStatus`, `ConflictChooser`                                                         | preact-components (exist)              |
| Three open bugs this depends on: the pull on the first open (ts-libs#399), an outbox event inside a transaction (#367), nested error bodies in `apiFetch` (#452) | ts-libs |
| `modules.ts`, each aggregate's adapter and wording, the level table above               | the template                           |

## Consequences

- ADR 002's sentence "The SPA is not usable with the socket blocked" stops being true, on purpose.
- Notes move onto the shared layer with no change a person can see; the existing offline e2e specs
  must pass unchanged. Queued writes already on a device keep their database name and shape.
- A new aggregate chooses a level and lists its operations; `docs/aggregates.md` and
  `docs/offline.md` gain the recipe for each level and both transports.
- Every list now costs storage on the device and one more thing to clear at sign-out. The data
  cache is per user and dropped at sign-out, so a shared browser keeps nothing readable.
- The call route is a second way in to every operation. It is covered by the same gates, and the
  transport test runs every scenario through it, so the cost is one more adapter to keep thin.
- A timer pull costs requests that the socket avoided. It runs only while a tab is visible and
  only in an app that has no socket module.

## Not decided here

- **Switching the selected group with no network.** It needs a rule for a setting that two devices
  change in opposite ways. Until then a person offline reads the group that was selected when the
  connection dropped.
- **Delta pulls.** See "Local data" above.
- **Moving the REST-only aggregates into the operations table.** Each moves when it needs to.

## Maintenance

Architecture owners review this record. If the ports, the level of an aggregate, or the home of a
piece changes, add a new ADR and mark this one superseded; do not rewrite accepted history.
