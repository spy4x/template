import { computed, signal } from "@preact/signals"
import { RealtimeRequestError } from "@spy4x/realtime"
import { type PlanRefusal, readPlanRefusal } from "@domain/billing"
import { apiFetch } from "./api.ts"
import { realtimeCommand, realtimeQuery } from "./realtime.ts"
import { currentLayer } from "../offline/index.ts"
import { offlineNotes } from "../offline/notes-offline.ts"

/** A note as the API sends it: dates are ISO strings, the sequence a decimal string. */
export interface NoteItem {
  id: string
  groupId: string
  title: string
  body: string
  version: number
  changeSequence: string
  createdByUserId: number | null
  updatedByUserId: number | null
  createdAt: string
  updatedAt: string
}

/** One page of a group's notes. */
export interface NotePage {
  notes: NoteItem[]
  nextCursor: string | null
}

/** What the notes store needs from the outside. Injected so tests need no network. */
export interface NotesDependencies {
  /** Reads one page of a group's notes, over REST: the same read at start-up and after a push. */
  fetchPage(groupId: string, cursor: string | null): Promise<NotePage>
  /** Reads one note over the socket. */
  get(groupId: string, id: string): Promise<{ note: NoteItem }>
  /**
   * The group of a note, found by its id alone. Rejects with `NOTE_NOT_FOUND` for a note that does
   * not exist and for one in a group the person is not in. Reads only: it never changes the
   * selected group.
   */
  locate?(id: string): Promise<{ groupId: string }>
  create(input: { groupId: string; id: string; title: string; body: string }): Promise<
    { note: NoteItem }
  >
  update(
    input: { groupId: string; id: string; title: string; body: string; version: number },
  ): Promise<{ note: NoteItem }>
  delete(input: { groupId: string; id: string; version: number }): Promise<unknown>
  /** Moves the notes to another group, all or none. Needs the server: it is never queued. */
  move(input: { groupId: string; toGroupId: string; noteIds: string[] }): Promise<
    { notes: NoteItem[] }
  >
  newId(): string
  /** What the device already holds of a group's notes, shown before the read answers. */
  readLocal?(groupId: string): Promise<readonly NoteItem[]>
}

interface Draft {
  title: string
  body: string
}

interface FormErrors {
  title: string | null
  form: string | null
  /** The group's plan refused the write: the screen shows an upgrade prompt for it. */
  plan?: PlanRefusal | null
}

interface Edit extends Draft {
  id: string
  version: number
  conflict: boolean
  /** The note as the edit started from it, to tell what the person changed. */
  base: Draft
}

const NO_ERRORS: FormErrors = { title: null, form: null }
const EMPTY_DRAFT: Draft = { title: "", body: "" }
const PAGE_LIMIT = 100
/** More pages than a group has notes in this template: a stop for a cursor loop. */
const MAX_PAGES = 20

export const NOTE_MESSAGES = {
  titleRequired: "Enter a title",
  conflict: "Someone changed this note since you opened it.",
  deleteConflict: "Someone changed that note, so it was not deleted.",
  gone: "This note was deleted.",
  load: "Could not load the notes",
  create: "Could not add the note",
  save: "Could not save the note",
  delete: "Could not delete the note",
  move: "Could not move the notes",
  moveOffline: "Moving notes needs a connection. Try again when you are back online.",
  moveNone: "Tick the notes you want to move.",
  moveUnsaved: "Save or discard your changes before moving the note.",
  moveGone: "A note you ticked is no longer here, so nothing was moved.",
} as const

function describe(error: unknown, fallback: string): string {
  return error instanceof RealtimeRequestError ? error.message : fallback
}

/** What the group's plan refused, read from the socket's `forbidden` details, or `null`. */
function planRefusal(error: unknown): PlanRefusal | null {
  return error instanceof RealtimeRequestError ? readPlanRefusal(error.details) : null
}

/** The note code of a refused call (`VERSION_CONFLICT`, `NOTE_NOT_FOUND`), or `null`. */
function noteCode(error: unknown): string | null {
  if (!(error instanceof RealtimeRequestError)) return null
  const code = (error.details as { code?: unknown } | undefined)?.code
  return typeof code === "string" ? code : null
}

/**
 * The notes screen's state: one group's notes, the create form, the note being edited and what
 * is in flight.
 *
 * Like the groups store, the list is always a full read of the server's answer, so the read after
 * a push and the read at start-up are one piece of code. The store's own writes do not move the
 * group's cursor: another member's change may have taken the sequence just before this one, and
 * moving past it would drop that change's hint. The hint of this tab's own write therefore costs
 * one extra read, which is the price of never missing a change.
 */
export function createNotesStore(dependencies: NotesDependencies) {
  const groupId = signal<string | null>(null)
  const notes = signal<readonly NoteItem[]>([])
  const loading = signal(false)
  const listError = signal<string | null>(null)
  const draftId = signal(dependencies.newId())
  const draft = signal<Draft>(EMPTY_DRAFT)
  const createErrors = signal<FormErrors>(NO_ERRORS)
  const creating = signal(false)
  const editing = signal<Edit | null>(null)
  const editErrors = signal<FormErrors>(NO_ERRORS)
  const saving = signal(false)
  const deleting = signal<string | null>(null)
  const moving = signal(false)
  /** The refusal of the last move, shown beside the move button. */
  const moveError = signal<string | null>(null)
  /** The open note is not in the open group: it is gone, or it is in another group. */
  const missing = signal(false)
  /** The open note is in another of the person's groups, with this id. Set with `missing`. */
  const elsewhere = signal<string | null>(null)
  /** The note the page was last asked to open: a late answer about another note is dropped. */
  let openId: string | null = null
  /** The person typed text that no save or create has taken yet. */
  const unsaved = computed(() => {
    const edit = editing.value
    if (edit) {
      return edit.conflict || edit.title !== edit.base.title || edit.body !== edit.base.body
    }
    return draft.value.title !== "" || draft.value.body !== ""
  })
  let inFlight: Promise<void> | null = null
  let queued: Promise<void> | null = null

  async function readAll(forGroup: string): Promise<void> {
    const all: NoteItem[] = []
    let cursor: string | null = null
    for (let page = 0; page < MAX_PAGES; page++) {
      const result = await dependencies.fetchPage(forGroup, cursor)
      all.push(...result.notes)
      cursor = result.nextCursor
      if (cursor === null) break
    }
    // The person may have opened another group while this read ran.
    if (groupId.value === forGroup) notes.value = all
  }

  function start(): Promise<void> {
    const forGroup = groupId.value
    if (!forGroup) return Promise.resolve()
    loading.value = true
    inFlight = readAll(forGroup).finally(() => {
      inFlight = null
      loading.value = false
    })
    return inFlight
  }

  /**
   * Reads the open group's notes. A read already running may have started before the change that
   * asked for this one, so exactly one more read is queued behind it, shared by every call made
   * meanwhile. Rejects when the read fails.
   */
  function refresh(): Promise<void> {
    if (!inFlight) return start()
    queued ??= inFlight.catch(() => {}).then(() => {
      queued = null
      return start()
    })
    return queued
  }

  /** Reads and shows a failure under the list instead of rejecting. */
  async function load(): Promise<void> {
    listError.value = null
    try {
      await refresh()
    } catch (cause) {
      listError.value = describe(cause, NOTE_MESSAGES.load)
    }
  }

  /** Shows what the device holds while the read runs, unless the read answered first. */
  async function showLocal(forGroup: string): Promise<void> {
    const local = await dependencies.readLocal?.(forGroup).catch(() => undefined)
    if (local && groupId.value === forGroup && loading.value && notes.value.length === 0) {
      notes.value = local
    }
  }

  /** Shows a group's notes, and the edit form of `noteId` when one is given. */
  async function open(nextGroupId: string, noteId: string | null): Promise<void> {
    if (groupId.value !== nextGroupId) {
      reset()
      groupId.value = nextGroupId
      openId = noteId
      void showLocal(nextGroupId)
      await load()
    } else openId = noteId
    if (noteId === null) {
      editing.value = null
      editErrors.value = NO_ERRORS
      missing.value = false
      elsewhere.value = null
      return
    }
    if (editing.value?.id === noteId) return
    editErrors.value = NO_ERRORS
    moveError.value = null
    missing.value = false
    elsewhere.value = null
    const known = notes.value.find((note) => note.id === noteId)
    if (known) {
      editing.value = toEdit(known)
      return
    }
    await reloadLatest(noteId)
  }

  /** The person's other group that holds the note, or `null` when there is none or it cannot be told. */
  async function locateElsewhere(noteId: string): Promise<string | null> {
    try {
      const found = await dependencies.locate?.(noteId)
      return found && found.groupId !== groupId.value ? found.groupId : null
    } catch (_error) {
      return null
    }
  }

  /** Rereads the edited note and starts the edit again from it, dropping what was typed. */
  async function reloadLatest(noteId = editing.value?.id): Promise<void> {
    const forGroup = groupId.value
    if (!forGroup || !noteId) return
    const stale = () => groupId.value !== forGroup || openId !== noteId
    try {
      const { note } = await dependencies.get(forGroup, noteId)
      editing.value = toEdit(note)
      editErrors.value = NO_ERRORS
      notes.value = notes.value.map((existing) => existing.id === note.id ? note : existing)
    } catch (cause) {
      // The person moved on while the read ran: the answer belongs to the earlier page.
      if (stale()) return
      editing.value = null
      if (noteCode(cause) === "NOTE_NOT_FOUND") {
        const other = await locateElsewhere(noteId)
        if (stale()) return
        elsewhere.value = other
        missing.value = true
      } else listError.value = describe(cause, NOTE_MESSAGES.load)
    }
  }

  /** Creates the note from the draft. Resolves the note once created, `null` when it was not. */
  async function create(): Promise<NoteItem | null> {
    const forGroup = groupId.value
    if (!forGroup || creating.value) return null
    const title = draft.value.title.trim()
    if (!title) {
      createErrors.value = { title: NOTE_MESSAGES.titleRequired, form: null }
      return null
    }
    creating.value = true
    createErrors.value = NO_ERRORS
    try {
      const { note } = await dependencies.create({
        groupId: forGroup,
        id: draftId.value,
        title,
        body: draft.value.body,
      })
      notes.value = [note, ...notes.value.filter((existing) => existing.id !== note.id)]
      draft.value = EMPTY_DRAFT
      draftId.value = dependencies.newId()
      return note
    } catch (cause) {
      createErrors.value = {
        title: null,
        form: describe(cause, NOTE_MESSAGES.create),
        plan: planRefusal(cause),
      }
      return null
    } finally {
      creating.value = false
    }
  }

  /** Saves the edit. Resolves `true` once saved, `false` when it was refused or failed. */
  async function save(): Promise<boolean> {
    const forGroup = groupId.value
    const edit = editing.value
    if (!forGroup || !edit || saving.value) return false
    const title = edit.title.trim()
    if (!title) {
      editErrors.value = { title: NOTE_MESSAGES.titleRequired, form: null }
      return false
    }
    saving.value = true
    editErrors.value = NO_ERRORS
    try {
      const { note } = await dependencies.update({
        groupId: forGroup,
        id: edit.id,
        title,
        body: edit.body,
        version: edit.version,
      })
      notes.value = notes.value.map((existing) => existing.id === note.id ? note : existing)
      editing.value = null
      return true
    } catch (cause) {
      const code = noteCode(cause)
      if (code === "VERSION_CONFLICT") {
        editing.value = { ...edit, conflict: true }
        editErrors.value = { title: null, form: NOTE_MESSAGES.conflict }
      } else {
        editErrors.value = {
          title: null,
          form: code === "NOTE_NOT_FOUND"
            ? NOTE_MESSAGES.gone
            : describe(cause, NOTE_MESSAGES.save),
        }
      }
      return false
    } finally {
      saving.value = false
    }
  }

  /** Drops what was typed into the create form, and starts a new note's id. */
  function discardDraft(): void {
    draft.value = EMPTY_DRAFT
    draftId.value = dependencies.newId()
    createErrors.value = NO_ERRORS
  }

  /** Deletes the note at the version the person saw. Resolves `true` once deleted, `false` when it was refused or failed. */
  async function remove(note: Pick<NoteItem, "id" | "version">): Promise<boolean> {
    const forGroup = groupId.value
    if (!forGroup || deleting.value) return false
    deleting.value = note.id
    listError.value = null
    try {
      await dependencies.delete({ groupId: forGroup, id: note.id, version: note.version })
      notes.value = notes.value.filter((existing) => existing.id !== note.id)
      editing.value = null
      return true
    } catch (cause) {
      const code = noteCode(cause)
      listError.value = code === "VERSION_CONFLICT"
        ? NOTE_MESSAGES.deleteConflict
        : describe(cause, NOTE_MESSAGES.delete)
      // The page of this note offers the latest version; the list is read again.
      const edit = editing.value
      if (code === "VERSION_CONFLICT" && edit?.id === note.id) {
        editing.value = { ...edit, conflict: true }
      }
      if (code === "VERSION_CONFLICT" || code === "NOTE_NOT_FOUND") await refresh().catch(() => {})
      return false
    } finally {
      deleting.value = null
    }
  }

  /**
   * Moves notes of the open group to another, all or none. Resolves `true` once moved, `false` when
   * it was refused or failed (the reason is in `moveError`). It needs the server and is never
   * queued: a move made offline would be a write the person cannot see settle.
   */
  async function move(toGroupId: string, noteIds: readonly string[]): Promise<boolean> {
    const forGroup = groupId.value
    if (!forGroup || moving.value) return false
    if (noteIds.length === 0) {
      moveError.value = NOTE_MESSAGES.moveNone
      return false
    }
    // Moving closes the note's page, which would drop what was typed: the person decides first.
    if (editing.value && unsaved.value && noteIds.includes(editing.value.id)) {
      moveError.value = NOTE_MESSAGES.moveUnsaved
      return false
    }
    moving.value = true
    moveError.value = null
    try {
      await dependencies.move({ groupId: forGroup, toGroupId, noteIds: [...noteIds] })
      const moved = new Set(noteIds)
      notes.value = notes.value.filter((existing) => !moved.has(existing.id))
      if (editing.value && moved.has(editing.value.id)) editing.value = null
      return true
    } catch (cause) {
      const code = noteCode(cause)
      moveError.value = code === "NOTE_NOT_FOUND"
        ? NOTE_MESSAGES.moveGone
        : cause instanceof RealtimeRequestError
        ? describe(cause, NOTE_MESSAGES.move)
        : NOTE_MESSAGES.moveOffline
      // The list is stale: another member changed it first.
      if (code === "NOTE_NOT_FOUND") await refresh().catch(() => {})
      return false
    } finally {
      moving.value = false
    }
  }

  function reset(): void {
    groupId.value = null
    notes.value = []
    loading.value = false
    listError.value = null
    draft.value = EMPTY_DRAFT
    draftId.value = dependencies.newId()
    createErrors.value = NO_ERRORS
    creating.value = false
    editing.value = null
    editErrors.value = NO_ERRORS
    saving.value = false
    deleting.value = null
    moving.value = false
    moveError.value = null
    missing.value = false
    elsewhere.value = null
    openId = null
    inFlight = null
    queued = null
  }

  return {
    groupId,
    notes,
    loading,
    listError,
    draftId,
    draft,
    createErrors,
    creating,
    editing,
    editErrors,
    saving,
    deleting,
    moving,
    moveError,
    missing,
    elsewhere,
    unsaved,
    open,
    refresh,
    reloadLatest,
    create,
    discardDraft,
    save,
    remove,
    move,
    reset,
  }
}

function toEdit(note: NoteItem): Edit {
  return {
    id: note.id,
    title: note.title,
    body: note.body,
    version: note.version,
    conflict: false,
    base: { title: note.title, body: note.body },
  }
}

/** The notes as the server serves them: reads over REST, writes over the socket. */
const onlineNotes: NotesDependencies = {
  async fetchPage(groupId, cursor) {
    const query = new URLSearchParams({ limit: String(PAGE_LIMIT) })
    if (cursor) query.set("cursor", cursor)
    const result = await apiFetch<NotePage>(`/api/groups/${groupId}/notes?${query}`)
    if (!result.ok) throw new Error(result.error.message)
    return result.data
  },
  get: (groupId, id) => realtimeQuery("note.get", { groupId, id }),
  locate: (id) => realtimeQuery("note.locate", { id }),
  create: (input) => realtimeCommand("note.create", input),
  update: (input) => realtimeCommand("note.update", input),
  delete: (input) => realtimeCommand("note.delete", input),
  move: (input) => realtimeCommand("note.move", input),
  newId: () => crypto.randomUUID(),
}

/**
 * The page's own store: reads over REST (start-up and after a push), writes over the socket, and
 * with the offline layer running, served from the device first and queued while offline.
 */
export const notesStore = createNotesStore(offlineNotes(onlineNotes, currentLayer))
