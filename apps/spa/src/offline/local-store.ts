import { Dexie, type EntityTable } from "dexie"
import type { NoteItem } from "../state/notes.ts"
import type { GroupItem } from "../state/groups.ts"

/** What an outgoing write does to a note. */
export type OutboxKind = "create" | "update" | "delete"

/**
 * Why a write stopped the queue for its note and now waits for a person:
 * - `version`: the note changed on the server since this write was based on it;
 * - `gone`: the note was deleted on the server;
 * - `rejected`: the server refused the write (for example the role no longer allows it).
 */
export type ConflictReason = "version" | "gone" | "rejected"

/** One write made while offline, waiting to be sent. */
export interface OutboxEntry {
  /** Send order. Assigned by the store when the entry is first saved. */
  seq?: number
  /** The idempotency key the write is sent with, so a send that is repeated runs once. */
  key: string
  groupId: string
  noteId: string
  kind: OutboxKind
  /** The note's text as this person wrote it; for a delete, the text it had when deleted. */
  title: string
  body: string
  /** The version the write was made on top of; `0` for a create. */
  baseVersion: number
  /** Whether a send was started: its outcome may be unknown, so the key must not be reused. */
  attempted: boolean
  status: "pending" | "conflict"
  conflict?: { reason: ConflictReason; message: string; server: NoteItem | null }
  queuedAt: string
}

/** Everything the offline layer keeps on this device for one signed-in user. */
export interface LocalStore {
  /** A group's notes as the server last answered, in the server's order. */
  readNotes(groupId: string): Promise<NoteItem[]>
  /** Replaces a group's notes with a full server answer. */
  replaceNotes(groupId: string, notes: readonly NoteItem[]): Promise<void>
  putNote(note: NoteItem): Promise<void>
  removeNote(noteId: string): Promise<void>
  readGroups(): Promise<GroupItem[]>
  replaceGroups(groups: readonly GroupItem[]): Promise<void>
  /** Every waiting write, in send order. */
  readOutbox(): Promise<OutboxEntry[]>
  /** Saves an entry; one without `seq` goes to the end of the queue. Resolves the saved entry. */
  putEntry(entry: OutboxEntry): Promise<OutboxEntry>
  removeEntry(seq: number): Promise<void>
  /** Drops the cached notes and groups, keeping the outbox: unsent writes are the person's work. */
  clearCache(): Promise<void>
  close(): void
}

type NoteRow = NoteItem & { order: number }

class OfflineDatabase extends Dexie {
  notes!: EntityTable<NoteRow, "id">
  groups!: EntityTable<GroupItem & { order: number }, "id">
  outbox!: EntityTable<OutboxEntry, "seq">

  constructor(name: string) {
    super(name)
    this.version(1).stores({
      notes: "id, groupId",
      groups: "id",
      outbox: "++seq, noteId, groupId",
    })
  }
}

function inOrder<T extends { order: number }>(rows: T[]): Omit<T, "order">[] {
  return rows.sort((a, b) => a.order - b.order).map(({ order: _order, ...rest }) => rest)
}

/** The IndexedDB database of one user on this browser. One database per user, never shared. */
export function openDexieStore(userId: number): LocalStore {
  const db = new OfflineDatabase(`offline:user:${userId}`)
  return {
    async readNotes(groupId) {
      return inOrder(await db.notes.where("groupId").equals(groupId).toArray())
    },
    async replaceNotes(groupId, notes) {
      await db.transaction("rw", db.notes, async () => {
        await db.notes.where("groupId").equals(groupId).delete()
        await db.notes.bulkPut(notes.map((note, order) => ({ ...note, order })))
      })
    },
    async putNote(note) {
      const existing = await db.notes.get(note.id)
      await db.notes.put({ ...note, order: existing?.order ?? -Date.now() })
    },
    async removeNote(noteId) {
      await db.notes.delete(noteId)
    },
    async readGroups() {
      return inOrder(await db.groups.toArray())
    },
    async replaceGroups(groups) {
      await db.transaction("rw", db.groups, async () => {
        await db.groups.clear()
        await db.groups.bulkPut(groups.map((group, order) => ({ ...group, order })))
      })
    },
    readOutbox: () => db.outbox.orderBy("seq").toArray(),
    async putEntry(entry) {
      const seq = await db.outbox.put(entry)
      return { ...entry, seq }
    },
    removeEntry: (seq) => db.outbox.delete(seq),
    async clearCache() {
      await db.transaction("rw", db.notes, db.groups, async () => {
        await db.notes.clear()
        await db.groups.clear()
      })
    },
    close: () => db.close(),
  }
}
