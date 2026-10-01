import { Dexie, type EntityTable } from "dexie"
import type { OutboxEntry, OutboxStore } from "@spy4x/realtime/outbox"
import type { NoteItem } from "../state/notes.ts"
import type { GroupItem } from "../state/groups.ts"

/** What the person wrote in a queued note write: the outbox's payload. */
export interface NotePayload {
  groupId: string
  title: string
  body: string
}

/** One queued note write, as the outbox from `@spy4x/realtime/outbox` keeps it. */
export type NoteEntry = OutboxEntry<NotePayload, NoteItem>

/** Everything the offline layer keeps on this device for one signed-in user. */
export interface LocalStore extends OutboxStore<NotePayload, NoteItem> {
  /** A group's notes as the server last answered, in the server's order. */
  readNotes(groupId: string): Promise<NoteItem[]>
  /** Replaces a group's notes with a full server answer. */
  replaceNotes(groupId: string, notes: readonly NoteItem[]): Promise<void>
  putNote(note: NoteItem): Promise<void>
  removeNote(noteId: string): Promise<void>
  readGroups(): Promise<GroupItem[]>
  replaceGroups(groups: readonly GroupItem[]): Promise<void>
  /** Drops the cached notes and groups, keeping the outbox: unsent writes are the person's work. */
  clearCache(): Promise<void>
  close(): void
}

type NoteRow = NoteItem & { order: number }

/**
 * Turns a queue row of the first database version (the note's id and text beside the entry) into
 * the outbox's shape (`entityId` and a `payload`), so a write still waiting on a device that had
 * the old version is sent after the upgrade. A row already in the new shape is returned as it is.
 */
export function entryFromV1(row: Record<string, unknown>): Record<string, unknown> {
  if (!("noteId" in row)) return row
  const { noteId, groupId, title, body, ...rest } = row
  return { ...rest, entityId: noteId, payload: { groupId, title, body } }
}

class OfflineDatabase extends Dexie {
  notes!: EntityTable<NoteRow, "id">
  groups!: EntityTable<GroupItem & { order: number }, "id">
  outbox!: EntityTable<NoteEntry, "seq">

  constructor(name: string) {
    super(name)
    this.version(1).stores({
      notes: "id, groupId",
      groups: "id",
      outbox: "++seq, noteId, groupId",
    })
    this.version(2).stores({ outbox: "++seq, entityId" }).upgrade((tx) =>
      tx.table("outbox").toCollection().modify((row) => {
        const next = entryFromV1(row)
        for (const key of Object.keys(row)) delete row[key]
        Object.assign(row, next)
      })
    )
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
