import {
  type DeletedNote,
  type Note,
  NoteCreateCommand,
  noteCreatePayloadSchema,
  NoteDeleteCommand,
  noteDeletePayloadSchema,
  noteGetPayloadSchema,
  NoteGetQuery,
  noteListPayloadSchema,
  NoteMoveCommand,
  noteMovePayloadSchema,
  NoteUpdateCommand,
  noteUpdatePayloadSchema,
  type NoteWriteResult,
  parseNoteMoveRequest,
  parseNoteRequest,
} from "@domain/notes"
import type { SocketRequests } from "../../services/realtime.ts"
import { DEFAULT_NOTE_LIST_LIMIT, listNotesPage, type NoteListDependencies } from "./list.ts"

/** What the note socket requests need from the app: the buses, and the list cursor. */
export interface NoteSocketDependencies extends NoteListDependencies {
  create(command: NoteCreateCommand): Promise<NoteWriteResult>
  update(command: NoteUpdateCommand): Promise<{ note: Note }>
  delete(command: NoteDeleteCommand): Promise<{ note: DeletedNote }>
  get(query: NoteGetQuery): Promise<{ note: Note }>
  move(command: NoteMoveCommand): Promise<{ notes: Note[] }>
}

/**
 * The note commands and queries the socket serves. Each parses its payload with the schemas the
 * REST route uses and dispatches on the same bus; who may do what is decided in the handlers.
 */
export function createNoteSocketRequests(dependencies: NoteSocketDependencies): SocketRequests {
  return {
    "note.create": {
      kind: "command",
      handle: async ({ actor, payload, idempotencyKey }) => {
        const input = parseNoteRequest(
          noteCreatePayloadSchema,
          payload,
        )
        return await dependencies.create(new NoteCreateCommand({ actor, ...input, idempotencyKey }))
      },
    },
    "note.update": {
      kind: "command",
      handle: async ({ actor, payload, idempotencyKey }) => {
        const input = parseNoteRequest(noteUpdatePayloadSchema, payload)
        return await dependencies.update(new NoteUpdateCommand({ actor, ...input, idempotencyKey }))
      },
    },
    "note.delete": {
      kind: "command",
      handle: async ({ actor, payload, idempotencyKey }) => {
        const input = parseNoteRequest(
          noteDeletePayloadSchema,
          payload,
        )
        return await dependencies.delete(new NoteDeleteCommand({ actor, ...input, idempotencyKey }))
      },
    },
    "note.move": {
      kind: "command",
      handle: async ({ actor, requestId, payload, idempotencyKey }) => {
        // A payload with no group id fails the schema; the group of a bad payload is not needed.
        const fromGroupId = (payload as { groupId?: string } | null)?.groupId ?? ""
        const input = parseNoteMoveRequest(noteMovePayloadSchema, payload, fromGroupId)
        return await dependencies.move(
          new NoteMoveCommand({ actor, ...input, requestId, idempotencyKey }),
        )
      },
    },
    "note.list": {
      kind: "query",
      handle: async ({ actor, payload }) => {
        const input = parseNoteRequest(
          noteListPayloadSchema,
          payload,
        )
        return await listNotesPage(dependencies, actor, input.groupId, {
          limit: input.limit ?? DEFAULT_NOTE_LIST_LIMIT,
          cursor: input.cursor,
        })
      },
    },
    "note.get": {
      kind: "query",
      handle: async ({ actor, payload }) => {
        const input = parseNoteRequest(
          noteGetPayloadSchema,
          payload,
        )
        return await dependencies.get(new NoteGetQuery({ actor, ...input }))
      },
    },
  }
}
