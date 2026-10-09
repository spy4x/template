import { createDataCache } from "@spy4x/platform/browser/data-cache"
import { createIndexedDbOutboxStore } from "@spy4x/realtime/outbox-indexeddb"
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
}

/** The one scope the groups list lives in. Notes use their group's id as the scope. */
const GROUPS_SCOPE = "groups"

/**
 * The IndexedDB databases of one user on this browser: the notes and groups the server last sent
 * (`createDataCache`) and the queue of writes (`createIndexedDbOutboxStore`), each its own database
 * named for the user, never shared between users.
 *
 * A device that ran the earlier Dexie version keeps its old `offline:user:<id>` database untouched
 * and unread: this template ships no migration, so a write still queued there is not sent.
 */
export function openLocalStore(userId: number): LocalStore {
  const prefix = `offline:user:${userId}`
  const notes = createDataCache<NoteItem>({ name: `${prefix}:notes`, getId: (note) => note.id })
  const groups = createDataCache<GroupItem>({
    name: `${prefix}:groups`,
    getId: (group) => group.id,
  })
  const outbox = createIndexedDbOutboxStore<NotePayload, NoteItem>({ name: `${prefix}:outbox` })
  return {
    ...outbox,
    readNotes: (groupId) => notes.read(groupId),
    replaceNotes: (groupId, next) => notes.replace(groupId, next),
    async putNote(note) {
      // A moved note changes scope: drop it from every other group's copy in the same step.
      const others = (await notes.scopes()).filter((scope) => scope !== note.groupId)
      await notes.batch([
        ...others.map((scope) => ({ op: "delete" as const, scope, id: note.id })),
        { op: "put", scope: note.groupId, item: note },
      ])
    },
    async removeNote(noteId) {
      // A note's group is not known here, so remove it from every scope that holds notes.
      const scopes = await notes.scopes()
      await notes.batch(scopes.map((scope) => ({ op: "delete" as const, scope, id: noteId })))
    },
    readGroups: () => groups.read(GROUPS_SCOPE),
    replaceGroups: (next) => groups.replace(GROUPS_SCOPE, next),
    clearCache: async () => {
      await notes.clearAll()
      await groups.clearAll()
    },
  }
}
