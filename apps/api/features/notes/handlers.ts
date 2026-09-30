import type { CommandHandler, QueryHandler } from "@spy4x/platform/cqrs"
import {
  assertCanReadNotes,
  assertCanWriteNotes,
  type GroupRoleLookup,
  NoteCreateCommand,
  NoteDeleteCommand,
  NoteError,
  NoteGetQuery,
  NoteListQuery,
  type NoteRepository,
  NoteUpdateCommand,
} from "@domain/notes"

/** What every note handler needs: the notes, and the actor's role in the note's group. */
export interface NoteHandlerDependencies {
  notes: NoteRepository
  groups: GroupRoleLookup
}

/**
 * The note handlers. Each one decides who may act before it touches a note: every member of the
 * group reads, an editor or above writes, and a stranger is told the group does not exist.
 * Session strength is checked earlier, by the session gate on both buses, so REST and the socket
 * get the same answer from the same code.
 */
export function createNoteCreateHandler(
  { notes, groups }: NoteHandlerDependencies,
): CommandHandler<NoteCreateCommand> {
  return async ({ data }) => {
    assertCanWriteNotes(await groups.roleOf(data.groupId, data.actor.userId))
    return await notes.create(
      { groupId: data.groupId, id: data.id, title: data.title, body: data.body },
      data.actor.userId,
    )
  }
}

export function createNoteUpdateHandler(
  { notes, groups }: NoteHandlerDependencies,
): CommandHandler<NoteUpdateCommand> {
  return async ({ data }) => {
    assertCanWriteNotes(await groups.roleOf(data.groupId, data.actor.userId))
    const note = await notes.update(
      {
        groupId: data.groupId,
        id: data.id,
        title: data.title,
        body: data.body,
        expectedVersion: data.version,
      },
      data.actor.userId,
    )
    return { note }
  }
}

export function createNoteDeleteHandler(
  { notes, groups }: NoteHandlerDependencies,
): CommandHandler<NoteDeleteCommand> {
  return async ({ data }) => {
    assertCanWriteNotes(await groups.roleOf(data.groupId, data.actor.userId))
    const note = await notes.delete(
      { groupId: data.groupId, id: data.id, expectedVersion: data.version },
      data.actor.userId,
    )
    return { note }
  }
}

export function createNoteListHandler(
  { notes, groups }: NoteHandlerDependencies,
): QueryHandler<NoteListQuery> {
  return async ({ data }) => {
    assertCanReadNotes(await groups.roleOf(data.groupId, data.actor.userId))
    return await notes.list(data.groupId, data.page)
  }
}

export function createNoteGetHandler(
  { notes, groups }: NoteHandlerDependencies,
): QueryHandler<NoteGetQuery> {
  return async ({ data }) => {
    assertCanReadNotes(await groups.roleOf(data.groupId, data.actor.userId))
    const note = await notes.get(data.groupId, data.id)
    if (!note) throw new NoteError("NOTE_NOT_FOUND", "Note not found")
    return { note }
  }
}
