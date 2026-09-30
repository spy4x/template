import type { NoteHandlerDependencies } from "../features/notes/handlers.ts"
import { db } from "../services/db.ts"

/**
 * What the note handlers run on: the notes table, and the actor's role read from the group's
 * membership in Postgres (never from a cache, since it decides who may write).
 */
export const noteDependencies: NoteHandlerDependencies = {
  notes: db.note,
  groups: {
    roleOf: async (groupId, userId) => (await db.group.getForMember(groupId, userId))?.role ?? null,
  },
}
