import type { GroupItem } from "../state/groups.ts"
import type { NoteItem } from "../state/notes.ts"
import { createMemoryOutboxStore } from "@spy4x/realtime/outbox"
import type { LocalStore, NotePayload } from "./local-store.ts"

/**
 * A `LocalStore` in memory, with the behaviour the IndexedDB one has that the logic relies on.
 * The unit tests of the offline layer run on it, because Deno has no IndexedDB.
 */
export function createMemoryStore(): LocalStore {
  let notes: NoteItem[] = []
  let groups: GroupItem[] = []
  const outbox = createMemoryOutboxStore<NotePayload, NoteItem>()
  return {
    ...outbox,
    readNotes: (groupId) =>
      Promise.resolve(notes.filter((note) => note.groupId === groupId).map((n) => ({ ...n }))),
    replaceNotes(groupId, next) {
      notes = [...notes.filter((note) => note.groupId !== groupId), ...next.map((n) => ({ ...n }))]
      return Promise.resolve()
    },
    putNote(note) {
      const at = notes.findIndex((existing) => existing.id === note.id)
      if (at === -1) notes = [{ ...note }, ...notes]
      else notes[at] = { ...note }
      return Promise.resolve()
    },
    removeNote(noteId) {
      notes = notes.filter((note) => note.id !== noteId)
      return Promise.resolve()
    },
    readGroups: () => Promise.resolve(groups.map((g) => ({ ...g }))),
    replaceGroups(next) {
      groups = next.map((g) => ({ ...g }))
      return Promise.resolve()
    },
    clearCache() {
      notes = []
      groups = []
      return Promise.resolve()
    },
    close() {},
  }
}
