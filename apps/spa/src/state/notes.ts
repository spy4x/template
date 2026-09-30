import { signal } from "@preact/signals"
import { RealtimeRequestError } from "@spy4x/realtime"
import { apiFetch } from "./api.ts"
import { realtimeCommand, realtimeQuery } from "./realtime.ts"

/** A note as the API sends it: dates are ISO strings, the sequence a decimal string. */
export interface NoteItem {
  id: string
  groupId: string
  title: string
  body: string
  version: number
  changeSequence: string
  createdByUserId: number
  updatedByUserId: number
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
  create(input: { groupId: string; id: string; title: string; body: string }): Promise<
    { note: NoteItem }
  >
  update(
    input: { groupId: string; id: string; title: string; body: string; version: number },
  ): Promise<{ note: NoteItem }>
  delete(input: { groupId: string; id: string; version: number }): Promise<unknown>
  newId(): string
}

interface Draft {
  title: string
  body: string
}

interface FormErrors {
  title: string | null
  form: string | null
}

interface Edit extends Draft {
  id: string
  version: number
  conflict: boolean
}

const NO_ERRORS: FormErrors = { title: null, form: null }
const EMPTY_DRAFT: Draft = { title: "", body: "" }
const PAGE_LIMIT = 100
/** More pages than a group has notes in this template: a stop for a cursor loop. */
const MAX_PAGES = 20

export const NOTE_MESSAGES = {
  titleRequired: "Enter a title",
  conflict: "Someone changed this note since you opened it.",
  deleteConflict:
    "Someone changed that note, so it was not deleted. The list shows it as it is now.",
  gone: "This note was deleted.",
  load: "Could not load the notes",
  create: "Could not add the note",
  save: "Could not save the note",
  delete: "Could not delete the note",
} as const

function describe(error: unknown, fallback: string): string {
  return error instanceof RealtimeRequestError ? error.message : fallback
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

  /** Shows a group's notes, and the edit form of `noteId` when one is given. */
  async function open(nextGroupId: string, noteId: string | null): Promise<void> {
    if (groupId.value !== nextGroupId) {
      reset()
      groupId.value = nextGroupId
      await load()
    }
    if (noteId === null) {
      editing.value = null
      editErrors.value = NO_ERRORS
      return
    }
    if (editing.value?.id === noteId) return
    editErrors.value = NO_ERRORS
    const known = notes.value.find((note) => note.id === noteId)
    if (known) {
      editing.value = toEdit(known)
      return
    }
    await reloadLatest(noteId)
  }

  /** Rereads the edited note and starts the edit again from it, dropping what was typed. */
  async function reloadLatest(noteId = editing.value?.id): Promise<void> {
    const forGroup = groupId.value
    if (!forGroup || !noteId) return
    try {
      const { note } = await dependencies.get(forGroup, noteId)
      editing.value = toEdit(note)
      editErrors.value = NO_ERRORS
      notes.value = notes.value.map((existing) => existing.id === note.id ? note : existing)
    } catch (cause) {
      editing.value = null
      listError.value = noteCode(cause) === "NOTE_NOT_FOUND"
        ? NOTE_MESSAGES.gone
        : describe(cause, NOTE_MESSAGES.load)
    }
  }

  async function create(): Promise<void> {
    const forGroup = groupId.value
    if (!forGroup || creating.value) return
    const title = draft.value.title.trim()
    if (!title) {
      createErrors.value = { title: NOTE_MESSAGES.titleRequired, form: null }
      return
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
    } catch (cause) {
      createErrors.value = { title: null, form: describe(cause, NOTE_MESSAGES.create) }
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

  async function remove(note: NoteItem): Promise<void> {
    const forGroup = groupId.value
    if (!forGroup || deleting.value) return
    deleting.value = note.id
    listError.value = null
    try {
      await dependencies.delete({ groupId: forGroup, id: note.id, version: note.version })
      notes.value = notes.value.filter((existing) => existing.id !== note.id)
    } catch (cause) {
      const code = noteCode(cause)
      listError.value = code === "VERSION_CONFLICT"
        ? NOTE_MESSAGES.deleteConflict
        : describe(cause, NOTE_MESSAGES.delete)
      if (code === "VERSION_CONFLICT" || code === "NOTE_NOT_FOUND") await refresh().catch(() => {})
    } finally {
      deleting.value = null
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
    open,
    refresh,
    reloadLatest,
    create,
    save,
    remove,
    reset,
  }
}

function toEdit(note: NoteItem): Edit {
  return { id: note.id, title: note.title, body: note.body, version: note.version, conflict: false }
}

/** The page's own store: reads over REST (start-up and after a push), writes over the socket. */
export const notesStore = createNotesStore({
  async fetchPage(groupId, cursor) {
    const query = new URLSearchParams({ limit: String(PAGE_LIMIT) })
    if (cursor) query.set("cursor", cursor)
    const result = await apiFetch<NotePage>(`/api/groups/${groupId}/notes?${query}`)
    if (!result.ok) throw new Error(result.error.message)
    return result.data
  },
  get: (groupId, id) => realtimeQuery("note.get", { groupId, id }),
  create: (input) => realtimeCommand("note.create", input),
  update: (input) => realtimeCommand("note.update", input),
  delete: (input) => realtimeCommand("note.delete", input),
  newId: () => crypto.randomUUID(),
})
