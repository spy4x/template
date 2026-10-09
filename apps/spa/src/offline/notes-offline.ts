import { RealtimeRequestError } from "@spy4x/realtime"
import type { NoteItem, NotePage, NotesDependencies } from "../state/notes.ts"
import type { OfflineLayer } from "./index.ts"
import { overlayNotes } from "./notes-outbox.ts"

/** The notes store's own cap on pages, so a runaway cursor stops the same way in both. */
const MAX_PAGES = 20

/**
 * Whether a call failed because the network is down, not because the server answered. `fetch`
 * rejects with a `TypeError` then; an answer with an error status never does.
 */
export function isUnreachable(error: unknown): boolean {
  return error instanceof TypeError
}

/**
 * Puts the local store and the queue behind the notes store's dependencies:
 * - a read asks the server for the whole list, keeps it and answers with the queued writes
 *   applied; with the network down it answers from what was kept;
 * - a write is queued and sent at once when the socket is open, and stays queued when it is not.
 *
 * Without a running layer every call goes to `online` untouched.
 */
export function offlineNotes(
  online: NotesDependencies,
  current: () => OfflineLayer | null,
): NotesDependencies {
  /** The note as this person sees it, with the queued writes applied. */
  async function visible(layer: OfflineLayer, groupId: string, id: string) {
    const notes = await overlay(layer, groupId, await layer.store.readNotes(groupId))
    return notes.find((note) => note.id === id)
  }

  /** The notes with the queued writes applied. */
  async function overlay(layer: OfflineLayer, groupId: string, base: readonly NoteItem[]) {
    return overlayNotes(await layer.store.readOutbox(), layer.userId, groupId, base)
  }

  return {
    ...online,
    async fetchPage(groupId, _cursor, deleted): Promise<NotePage> {
      const layer = current()
      // The deleted notes are read from the server only: the device keeps no copy of them.
      if (!layer || deleted) return await online.fetchPage(groupId, _cursor, deleted)
      let base: NoteItem[]
      try {
        base = []
        let cursor: string | null = null
        for (let page = 0; page < MAX_PAGES; page++) {
          const result = await online.fetchPage(groupId, cursor)
          base.push(...result.notes)
          cursor = result.nextCursor
          if (cursor === null) break
        }
        await layer.store.replaceNotes(groupId, base)
      } catch (error) {
        if (!isUnreachable(error)) throw error
        base = await layer.store.readNotes(groupId)
      }
      return { notes: await overlay(layer, groupId, base), nextCursor: null }
    },
    async get(groupId, id) {
      const layer = current()
      if (!layer) return await online.get(groupId, id)
      try {
        const { note } = await online.get(groupId, id)
        await layer.store.putNote(note)
        const [mine] = (await overlay(layer, groupId, [note])).filter((n) => n.id === id)
        return { note: mine ?? note }
      } catch (error) {
        // The server's "not found" is final, except for a note created here and not yet sent.
        const local = await visible(layer, groupId, id)
        if (local && (!(error instanceof RealtimeRequestError) || local.version === 0)) {
          return { note: local }
        }
        throw error
      }
    },
    async create(input) {
      const layer = current()
      if (!layer) return await online.create(input)
      const outcome = await layer.outbox.submit({
        kind: "create",
        entityId: input.id,
        payload: { groupId: input.groupId, title: input.title, body: input.body },
      })
      return await answer(layer, outcome, input.groupId, input.id)
    },
    async update(input) {
      const layer = current()
      if (!layer) return await online.update(input)
      const outcome = await layer.outbox.submit({
        kind: "update",
        entityId: input.id,
        payload: { groupId: input.groupId, title: input.title, body: input.body },
        version: input.version,
      })
      return await answer(layer, outcome, input.groupId, input.id)
    },
    async delete(input) {
      const layer = current()
      if (!layer) return await online.delete(input)
      const known = await visible(layer, input.groupId, input.id)
      const outcome = await layer.outbox.submit({
        kind: "delete",
        entityId: input.id,
        payload: { groupId: input.groupId, title: known?.title ?? "", body: known?.body ?? "" },
        version: input.version,
      })
      if (outcome.kind === "failed") throw outcome.error
      return undefined
    },
    async restore(input) {
      const layer = current()
      // An Undo of a delete that has not left the device takes the queued delete back: no
      // network is needed, and nothing reaches the server.
      if (layer && await layer.outbox.withdraw(input.id)) {
        const note = await visible(layer, input.groupId, input.id)
        if (note) return { note }
      }
      // Otherwise it needs the server, like a move: it is never queued, so a person offline is
      // told so.
      const result = await online.restore(input)
      if (layer) await layer.store.putNote(result.note)
      return result
    },
    async move(input) {
      const result = await online.move(input)
      // The moved notes now belong to the other group on this device too. Writes still queued for
      // them were made in the old group, and the server refuses those as a conflict.
      const layer = current()
      if (layer) { for (const note of result.notes) await layer.store.putNote(note) }
      return result
    },
    async readLocal(groupId) {
      const layer = current()
      if (!layer) return []
      return await overlay(layer, groupId, await layer.store.readNotes(groupId))
    },
  }

  async function answer(
    layer: OfflineLayer,
    outcome: Awaited<ReturnType<OfflineLayer["outbox"]["submit"]>>,
    groupId: string,
    id: string,
  ): Promise<{ note: NoteItem }> {
    if (outcome.kind === "failed") throw outcome.error
    const note = await visible(layer, groupId, id)
    if (!note) throw new Error("The note is not in the local store")
    return { note }
  }
}
