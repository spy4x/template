# Offline in the SPA

The SPA opens with no network, shows the notes it last saw, lets a person add, edit and delete
notes, and sends those changes when the connection is back. A change the server cannot take is
shown as a conflict for the person to settle; nothing is overwritten on its own.

All of it lives in `apps/spa/src/offline/` and one file in `apps/spa/public/`. Everything else in
the SPA works without them ([how to remove the layer](#removing-the-layer)).

## How it works

| Piece                                       | What it does                                                                                                              |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `offline/local-store.ts`                    | The Dexie (IndexedDB) database, one per signed-in user: the last notes and groups the server sent, and the outbox.        |
| `offline/outbox.ts`                         | The queue of writes made while offline, the send loop, and the conflict rules. No Dexie or network in it: both injected.  |
| `offline/notes-offline.ts`, `groups-offline.ts` | Wrap the notes and groups stores' dependencies: reads keep and serve the local copy, note writes go through the outbox. |
| `offline/OfflineStatus.tsx`                 | Shows "N changes are waiting to sync" and each conflict, with "Keep mine" and "Use the server's".                         |
| `offline/session-cache.ts`                  | Remembers who was signed in, so an offline start does not show the sign-in page.                                          |
| `offline/index.ts`                          | Starts and stops the layer for a user; the one place that touches the socket.                                             |
| `public/offline-shell.js`                   | The service worker code that caches the app's page, scripts and styles.                                                   |

### Reads: the device first

The notes and groups stores are unchanged in what they do: every read is a full read of the
server's answer, whether at start-up, after a reconnect or after a pushed hint
([ADR 002](decisions/002-realtime-transport-and-sync.md), "Push with sequence, pull as the
authority"). The offline layer sits behind that read:

- When the server answers, the whole answer replaces the group's local copy, and the queued
  writes are applied on top of it.
- When the network is down (`fetch` rejects), the local copy answers instead. An answer with an
  error status is not a network failure and is shown as the error it is.
- When a screen opens, the stores show the local copy at once and replace it when the read
  answers, so a slow connection does not show an empty list.

Because the local copy is replaced by every full read, it cannot drift from the server: the read
that runs after a reconnect is the same read that heals the store.

### Writes: the outbox

A note create, update or delete is saved in the outbox, in IndexedDB, then sent at once if the
socket is open. If it is not, the entry waits, and the person sees the change in the list with a
"waiting to sync" line. `App` sends the queue in order before every read, and the read runs after
every reconnect and after every pushed hint.

- **Idempotency.** Every entry carries its own idempotency key, sent with the command, so a send
  that is repeated after a dropped connection runs once
  ([ADR 002](decisions/002-realtime-transport-and-sync.md), "Idempotency"). The server keeps keys
  for 7 days. A write older than that can still be sent: a replayed create answers "id already
  exists" and a replayed update answers a version conflict, and both show as conflicts, not as
  silent duplicates.
- **One entry per note.** A second edit of a note that was not sent yet replaces the first, so
  the queue holds what the person wants the note to be. Create then delete before any send sends
  nothing. An edit made after a send whose outcome is unknown gets a new key: the server would
  answer the old key with the first result and drop the new text. If that first send had been
  applied, the result is a conflict the person can see, not a lost edit.
- **Order.** Entries go out in the order they were made, and the loop stops at the first one that
  cannot reach the server.
- **Base version.** An update or delete carries the version the note had when the person started
  the edit. The server rejects it when the note moved on.

### Conflicts

When the server refuses a queued write, the entry stays in the outbox marked as a conflict, and
the notes screen shows both sides:

| Why                                | What the person can do                                        |
| ---------------------------------- | ------------------------------------------------------------- |
| The note changed on the server     | **Keep mine** sends the person's text on top of the server's version, or **Use the server's** drops it. |
| The note was deleted on the server | **Use the server's** removes it locally. The person's text stays on the screen until they choose. |
| The server refused the write (role) | **Discard mine**.                                            |

A write made online that the server refuses is not queued: the notes store shows it as before
(the "Someone changed this note" message and "Load the latest version").

### The app shell

`public/offline-shell.js` is loaded by `public/sw.js` with `importScripts`. On install it stores
`/` and every script, style and image the page names. After that:

- files under `/assets/` (a build names them by content hash, so a copy is never stale) are
  answered from the cache first;
- every other request, the page itself included, goes to the network first and is answered from
  the cache only when the network fails, so a deploy, and an edit under the dev server, show at
  once. Every route is the same page, so any page load is stored and served under `/`;
- `/api` is never touched.

Files of old builds stay in the cache until the cache name in the file changes.

`SWUpdater` from `@spy4x/preact-system` already registered `/sw.js` for push notifications, so no
registration was added. A person's first visit is online by definition; the app can go offline
after the worker installed, which is after that first load.

### Signing out

Signing out drops the cached notes and groups and the remembered user. The outbox stays: a write
that never reached the server is the person's work, and goes out the next time the same user
signs in on this browser.

## What is not offline

Creating a group, the profile, two-factor set-up and sign-in need the server. Two tabs of one
browser each run the queue; the idempotency keys make that safe, and a note edited in both shows
as a conflict in the second.

## Removing the layer

A product that does not want offline deletes the layer and keeps an online SPA that still gets live
updates. Do these steps. The guard test `tests/offline-removal.test.ts` fails when a file that imports the
layer is missing from this list. Following them on this repository ends with `deno task check` and
`deno task spa:build` passing.

1. Delete the folder `apps/spa/src/offline/` and the file `apps/spa/public/offline-shell.js`.
2. In `apps/spa/public/sw.js`, delete the `importScripts("/offline-shell.js")` line.
3. In `apps/spa/src/app.tsx`, delete the two `./offline/` imports and their uses:
   `bootstrapSession(recallUser)` becomes `bootstrapSession()`; drop the effect that remembers the
   user, the `stopOffline` line, the `flushOutbox()` line in `pull` and the `startOffline(userId)`
   line.
4. In `apps/spa/src/state/notes.ts` and `apps/spa/src/state/groups.ts`, delete the `./offline/`
   imports, and export the store built from `onlineNotes` and `onlineGroups` directly:
   `createNotesStore(onlineNotes)`, `createGroupsStore(onlineGroups)`. The optional `readLocal`
   dependency and its `showLocal` call can go with them.
5. In `apps/spa/src/state/realtime.ts`, delete `isRealtimeOpen`.
6. In `apps/spa/src/views/NotesView.tsx`, delete the `OfflineStatus` import and element.
7. Remove `dexie` from `deno.jsonc` and run `deno install` to update `deno.lock`.
8. Delete the spec `e2e/offline.e2e.ts`, and this guard test with its clause at the end of the
   `test` task in `deno.jsonc`: `tests/offline-removal.test.ts`. The unit tests lived in the
   folder and went with it.

`deno task check` and `deno task spa:build` then pass, and the app behaves as it did before the
layer existed: reads and writes over the network only.
