import { assertRoomFor } from "@domain/billing"
import { GroupRole } from "@domain/groups"
import {
  type DeletedNote,
  type GroupRoleLookup,
  type Note,
  type NoteCreateInput,
  type NoteDeleteInput,
  NoteError,
  type NoteListPage,
  type NoteListResult,
  type NoteMoveInput,
  type NoteRepository,
  type NoteUpdateInput,
  NoteVersionConflictError,
  type NoteWriteResult,
} from "@domain/notes"

/**
 * Notes in memory, with the Postgres repository's version rules: an update or delete at another
 * version is refused with the current one. `writes` counts every write that changed something.
 */
export class MemoryNoteRepository implements NoteRepository {
  readonly notes = new Map<string, Note>()
  writes = 0
  #sequence = 1

  list(groupId: string, page: NoteListPage): Promise<NoteListResult> {
    const notes = [...this.notes.values()].filter((note) => note.groupId === groupId)
      .slice(0, page.limit)
    return Promise.resolve({ notes, nextPageKey: null })
  }

  get(groupId: string, id: string): Promise<Note | null> {
    const note = this.notes.get(id)
    return Promise.resolve(note && note.groupId === groupId ? note : null)
  }

  groupIdOf(id: string): Promise<string | null> {
    return Promise.resolve(this.notes.get(id)?.groupId ?? null)
  }

  create(
    input: NoteCreateInput,
    actorId: number,
    allowance: number | null,
  ): Promise<NoteWriteResult> {
    if (this.notes.has(input.id)) throw new NoteError("ID_ALREADY_EXISTS", "taken")
    const used = [...this.notes.values()].filter((note) => note.groupId === input.groupId).length
    assertRoomFor("maxNotes", allowance, used, GroupRole.EDITOR)
    const at = new Date("2026-10-02T10:00:00.000Z")
    const note: Note = {
      ...input,
      version: 1,
      changeSequence: String(this.#sequence++),
      createdByUserId: actorId,
      updatedByUserId: actorId,
      createdAt: at,
      updatedAt: at,
    }
    this.notes.set(note.id, note)
    this.writes++
    return Promise.resolve({ note, created: true })
  }

  update(input: NoteUpdateInput, actorId: number): Promise<Note> {
    const note = this.#current(input.groupId, input.id, input.expectedVersion)
    const next: Note = {
      ...note,
      title: input.title,
      body: input.body,
      version: note.version + 1,
      changeSequence: String(this.#sequence++),
      updatedByUserId: actorId,
    }
    this.notes.set(next.id, next)
    this.writes++
    return Promise.resolve(next)
  }

  delete(input: NoteDeleteInput, _actorId: number): Promise<DeletedNote> {
    const note = this.#current(input.groupId, input.id, input.expectedVersion)
    this.notes.delete(note.id)
    this.writes++
    return Promise.resolve({
      id: note.id,
      groupId: note.groupId,
      version: note.version + 1,
      changeSequence: String(this.#sequence++),
    })
  }

  move(input: NoteMoveInput, actorId: number, allowance: number | null): Promise<Note[]> {
    const notes = input.noteIds.map((id) => {
      const note = this.notes.get(id)
      if (!note || note.groupId !== input.fromGroupId) {
        throw new NoteError("NOTE_NOT_FOUND", "gone")
      }
      return note
    })
    const used = [...this.notes.values()].filter((note) => note.groupId === input.toGroupId).length
    assertRoomFor("maxNotes", allowance, used + notes.length - 1, GroupRole.EDITOR)
    const sequence = String(this.#sequence++)
    const moved = notes.map((note): Note => ({
      ...note,
      groupId: input.toGroupId,
      version: note.version + 1,
      changeSequence: sequence,
      updatedByUserId: actorId,
    }))
    for (const note of moved) this.notes.set(note.id, note)
    this.writes++
    return Promise.resolve(moved)
  }

  #current(groupId: string, id: string, expectedVersion: number): Note {
    const note = this.notes.get(id)
    if (!note || note.groupId !== groupId) throw new NoteError("NOTE_NOT_FOUND", "gone")
    if (note.version !== expectedVersion) throw new NoteVersionConflictError(note.version)
    return note
  }
}

/** Roles by `groupId:userId`; anyone not listed is not a member. */
export function roles(entries: Record<string, GroupRole>): GroupRoleLookup {
  return {
    roleOf: (groupId, userId) => Promise.resolve(entries[`${groupId}:${userId}`] ?? null),
  }
}
