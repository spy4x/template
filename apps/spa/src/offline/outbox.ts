import { signal } from "@preact/signals"
import { RealtimeRequestError } from "@spy4x/realtime"
import type { NoteItem } from "../state/notes.ts"
import { isRetryable } from "../state/realtime-call.ts"
import type { ConflictReason, LocalStore, OutboxEntry, OutboxKind } from "./local-store.ts"

/** What a person did to a note. */
export type Change =
  | { kind: "create"; groupId: string; noteId: string; title: string; body: string }
  | {
    kind: "update"
    groupId: string
    noteId: string
    title: string
    body: string
    /** The version the person's edit started from. */
    version: number
  }
  | {
    kind: "delete"
    groupId: string
    noteId: string
    title: string
    body: string
    version: number
  }

/** How a change ended for the person who made it. */
export type Outcome =
  /** The server took it. `note` is its answer (not for a delete). */
  | { kind: "sent"; note?: NoteItem }
  /** It is saved on this device and goes out when the connection is back. */
  | { kind: "queued" }
  /** It never reached the server: created and deleted before any send. */
  | { kind: "dropped" }
  /** The server refused it. Nothing is queued; `error` says why. */
  | { kind: "failed"; error: RealtimeRequestError }

/** What the outbox needs from the outside. Injected so tests need no network or IndexedDB. */
export interface OutboxPorts {
  store: LocalStore
  /** Sends one command over the socket with the idempotency key. One try; the outbox retries. */
  send(
    name: `note.${OutboxKind}`,
    payload: Record<string, unknown>,
    idempotencyKey: string,
  ): Promise<unknown>
  /** The server's note as it is now, or `null` when it is gone. Rejects when unreachable. */
  fetchNote(groupId: string, noteId: string): Promise<NoteItem | null>
  /** Whether the socket is open. A write is not started while it is not: nothing left the device. */
  isOnline(): boolean
  userId: number
  newKey(): string
  now(): string
}

const CONFLICT_MESSAGES: Record<ConflictReason, string> = {
  version: "Someone changed this note while you were offline.",
  gone: "This note was deleted while you were offline.",
  rejected: "The server did not accept this change.",
}

function codeOf(error: RealtimeRequestError): string | null {
  const code = (error.details as { code?: unknown } | undefined)?.code
  return typeof code === "string" ? code : null
}

/**
 * The queue of writes made while offline. It keeps at most one entry per note: a second edit of a
 * note that has not been sent yet replaces the first, so the queue holds what the person wants
 * the note to be and nothing to replay in between.
 *
 * Every send carries the entry's idempotency key. An entry whose send may have reached the server
 * (`attempted`) gets a new key when the person changes it again, because the server would answer
 * the old key with the first result and drop the new text. The price is a conflict in the case
 * where the first send had in fact been applied, which is shown, never hidden.
 */
export function createOutbox(ports: OutboxPorts) {
  const { store } = ports
  /** The waiting writes, for the screen. Refreshed after every change to the queue. */
  const entries = signal<readonly OutboxEntry[]>([])
  const interactive = new Set<number>()
  const outcomes = new Map<number, Outcome>()
  let tail: Promise<unknown> = Promise.resolve()

  /** Runs one step of work on the queue at a time, in the order asked. */
  function locked<T>(work: () => Promise<T>): Promise<T> {
    const run = tail.then(work)
    tail = run.catch(() => {})
    return run
  }

  async function reload(): Promise<OutboxEntry[]> {
    const all = await store.readOutbox()
    entries.value = all
    return all
  }

  async function save(entry: OutboxEntry): Promise<OutboxEntry> {
    const saved = await store.putEntry(entry)
    await reload()
    return saved
  }

  async function drop(seq: number): Promise<void> {
    await store.removeEntry(seq)
    await reload()
  }

  /** Records a change in the queue, merging it with the note's waiting entry. */
  async function enqueue(change: Change): Promise<OutboxEntry | null> {
    const existing = (await store.readOutbox()).find((entry) => entry.noteId === change.noteId)
    const text = { title: change.title, body: change.body }
    if (!existing) {
      return await save({
        key: ports.newKey(),
        groupId: change.groupId,
        noteId: change.noteId,
        kind: change.kind,
        ...text,
        baseVersion: change.kind === "create" ? 0 : change.version,
        attempted: false,
        status: "pending",
        queuedAt: ports.now(),
      })
    }
    // A deleted note is not edited again.
    if (existing.kind === "delete" || change.kind === "create") return existing
    const renewed = existing.attempted
      ? { key: ports.newKey(), attempted: false }
      : { key: existing.key, attempted: false }
    if (change.kind === "update") return await save({ ...existing, ...text, ...renewed })
    if (existing.kind === "create") {
      if (!existing.attempted) {
        await drop(existing.seq!)
        return null
      }
      // The create may have reached the server, so the note may exist there: delete version 1.
      return await save({
        ...existing,
        ...text,
        kind: "delete",
        baseVersion: 1,
        key: ports.newKey(),
        attempted: false,
        status: "pending",
        conflict: undefined,
      })
    }
    return await save({ ...existing, ...text, kind: "delete", ...renewed })
  }

  function commandOf(entry: OutboxEntry): [`note.${OutboxKind}`, Record<string, unknown>] {
    const base = { groupId: entry.groupId, id: entry.noteId }
    if (entry.kind === "create") {
      return ["note.create", { ...base, title: entry.title, body: entry.body }]
    }
    if (entry.kind === "update") {
      return [
        "note.update",
        { ...base, title: entry.title, body: entry.body, version: entry.baseVersion },
      ]
    }
    return ["note.delete", { ...base, version: entry.baseVersion }]
  }

  /** Marks an entry as waiting for a person's decision. */
  async function markConflict(
    entry: OutboxEntry,
    reason: ConflictReason,
    server: NoteItem | null,
    message = CONFLICT_MESSAGES[reason],
  ): Promise<void> {
    await save({ ...entry, status: "conflict", conflict: { reason, message, server } })
  }

  /** Sends one entry. Resolves `false` when the queue must stop here (unreachable server). */
  async function sendOne(seq: number): Promise<boolean> {
    const entry = (await store.readOutbox()).find((candidate) => candidate.seq === seq)
    if (!entry || entry.status !== "pending") return true
    if (!ports.isOnline()) return false
    const wants = interactive.has(seq)
    // Saved before the send: a page closed mid-send must not repeat it under a new key.
    const sending = await save({ ...entry, attempted: true })
    const [name, payload] = commandOf(sending)
    try {
      const result = await ports.send(name, payload, sending.key)
      const note = (result as { note?: NoteItem } | undefined)?.note
      if (sending.kind === "delete") await store.removeNote(sending.noteId)
      else if (note) await store.putNote(note)
      await drop(seq)
      if (wants) {
        outcomes.set(seq, { kind: "sent", note: sending.kind === "delete" ? undefined : note })
      }
      return true
    } catch (error) {
      if (!(error instanceof RealtimeRequestError) || isRetryable(error)) return false
      return await refuse(sending, error, wants)
    }
  }

  /** Handles a refusal by the server. Resolves `false` when the server could not be asked more. */
  async function refuse(
    entry: OutboxEntry,
    error: RealtimeRequestError,
    wants: boolean,
  ): Promise<boolean> {
    const code = codeOf(error)
    if (code === "NOTE_NOT_FOUND" && entry.kind === "delete") {
      await store.removeNote(entry.noteId)
      await drop(entry.seq!)
      if (wants) outcomes.set(entry.seq!, { kind: "sent" })
      return true
    }
    if (wants) {
      // The person is looking at the screen: the store shows the refusal as it always did.
      await drop(entry.seq!)
      outcomes.set(entry.seq!, { kind: "failed", error })
      return true
    }
    let reason: ConflictReason = "rejected"
    let server: NoteItem | null = null
    const stale = code === "VERSION_CONFLICT" || (code === "ID_ALREADY_EXISTS" &&
      entry.kind === "create")
    if (stale || code === "NOTE_NOT_FOUND") {
      try {
        server = await ports.fetchNote(entry.groupId, entry.noteId)
      } catch (_unreachable) {
        return false
      }
      reason = server ? "version" : "gone"
    }
    await markConflict(entry, reason, server, reason === "rejected" ? error.message : undefined)
    return true
  }

  /**
   * Sends every waiting write in order, stopping at the first that cannot reach the server.
   * Called after a change, after a reconnect and after every push that is news.
   */
  async function flush(): Promise<void> {
    const waiting = (await locked(reload)).filter((entry) => entry.status === "pending")
    for (const entry of waiting) {
      const goOn = await locked(() => sendOne(entry.seq!))
      if (!goOn) return
    }
  }

  /** Records a change and sends it when the socket allows. */
  async function submit(change: Change): Promise<Outcome> {
    const entry = await locked(async () => {
      const queued = await enqueue(change)
      // Marked inside the same step, so no send can settle the entry before it is watched.
      if (queued) interactive.add(queued.seq!)
      return queued
    })
    if (!entry) return { kind: "dropped" }
    try {
      await flush()
      return outcomes.get(entry.seq!) ?? { kind: "queued" }
    } finally {
      interactive.delete(entry.seq!)
      outcomes.delete(entry.seq!)
    }
  }

  /** The notes as this person sees them: the server's, with the waiting writes applied. */
  async function overlay(groupId: string, base: readonly NoteItem[]): Promise<NoteItem[]> {
    let notes = [...base]
    for (const entry of await store.readOutbox()) {
      if (entry.groupId !== groupId) continue
      if (entry.kind === "delete") {
        notes = notes.filter((note) => note.id !== entry.noteId)
        continue
      }
      const at = notes.findIndex((note) => note.id === entry.noteId)
      if (at !== -1) {
        notes[at] = { ...notes[at], title: entry.title, body: entry.body }
      } else if (entry.kind === "create") {
        notes.unshift({
          id: entry.noteId,
          groupId,
          title: entry.title,
          body: entry.body,
          version: 0,
          changeSequence: "0",
          createdByUserId: ports.userId,
          updatedByUserId: ports.userId,
          createdAt: entry.queuedAt,
          updatedAt: entry.queuedAt,
        })
      }
    }
    return notes
  }

  /** Sends the person's version again, on top of the server's current one. */
  async function keepMine(seq: number): Promise<void> {
    await locked(async () => {
      const entry = (await store.readOutbox()).find((candidate) => candidate.seq === seq)
      const server = entry?.conflict?.server
      if (!entry || !server) return
      await store.putNote(server)
      await save({
        ...entry,
        kind: entry.kind === "delete" ? "delete" : "update",
        baseVersion: server.version,
        key: ports.newKey(),
        attempted: false,
        status: "pending",
        conflict: undefined,
      })
    })
    await flush()
  }

  /** Drops the person's version and shows the server's. */
  async function useTheirs(seq: number): Promise<void> {
    await locked(async () => {
      const entry = (await store.readOutbox()).find((candidate) => candidate.seq === seq)
      if (!entry) return
      const server = entry.conflict?.server
      if (server) await store.putNote(server)
      else if (entry.conflict?.reason === "gone") await store.removeNote(entry.noteId)
      await drop(seq)
    })
  }

  return { entries, reload: () => locked(reload), submit, flush, overlay, keepMine, useTheirs }
}

/** The outbox as the offline layer uses it. */
export type Outbox = ReturnType<typeof createOutbox>
