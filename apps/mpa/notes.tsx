import type { FreshContext } from "fresh"
import { canMutateNotes } from "@domain/groups"
import { NoteEditorScreen, type NoteTarget } from "@ui/note-editor-screen.tsx"
import {
  type MoveTarget,
  moveTargetsOf,
  type NoteDraft,
  type NoteFormErrors,
  type NoteRow,
  type NotesGroup,
  NotesScreen,
} from "@ui/notes-screen.tsx"
import { NOTE_PATHS, SCREEN_PATHS } from "@ui/progressive.tsx"
import {
  type Api,
  type ApiAnswer,
  errorCode,
  errorMessage,
  isOk,
  isRecord,
  planRefusalOf,
} from "./api.ts"
import { readGroup, readSelected } from "./groups.ts"
import { Frame, readSession, type Session, signInPath } from "./session.tsx"
import type { State } from "./utils.ts"

const NO_ERRORS: NoteFormErrors = { title: null, form: null }

/** What the list page shows besides the list: the error of the last post. */
export interface NotesPageState {
  listError?: string | null
  /** The refusal of a move, shown by the list's move button. */
  moveError?: string | null
  status?: number
}

/** The API path of a group's notes, or of one note. Both ids are escaped into their segment. */
export function notesApiPath(groupId: string, noteId?: string): `/api/${string}` {
  const base = `/api/groups/${encodeURIComponent(groupId)}/notes` as const
  return noteId === undefined ? base : `${base}/${encodeURIComponent(noteId)}`
}

/** One note as the API answers it, reduced to what the screen shows; `null` for anything else. */
function toRow(value: unknown): NoteRow | null {
  if (!isRecord(value)) return null
  const { id, title, body, version } = value
  if (typeof id !== "string" || typeof title !== "string" || typeof body !== "string") return null
  if (typeof version !== "number") return null
  return { id, title, body, version }
}

/** The note an answer carries under `note`, or `null`. */
export function noteOf(answer: ApiAnswer): NoteRow | null {
  return isOk(answer) && isRecord(answer.body) ? toRow(answer.body.note) : null
}

async function listNotes(api: Api, groupId: string, cursor: string | null) {
  const query = cursor ? `?${new URLSearchParams({ cursor })}` : ""
  const answer = await api.call("GET", `${notesApiPath(groupId)}${query}`)
  if (!isOk(answer) || !isRecord(answer.body) || !Array.isArray(answer.body.notes)) {
    return { notes: [], nextCursor: null, error: errorMessage(answer, "Notes could not be read") }
  }
  const next = answer.body.nextCursor
  return {
    notes: answer.body.notes.map(toRow).filter((row): row is NoteRow => row !== null),
    nextCursor: typeof next === "string" ? next : null,
    error: null,
  }
}

/**
 * An old `/groups/:groupId/notes[/:noteId]` link. When that group is already the selected one, the
 * link goes to the notes at their new address. Otherwise it goes to the groups page: selecting is a
 * change, and the API refuses a change a page load makes (it takes only a post the browser made
 * from the app's own page, so another site cannot switch a person's group with a link). The groups
 * page has an "Open notes" button for every group, which is that post.
 */
export async function redirectFromOldNotesPath(
  ctx: FreshContext<State>,
  groupId: string,
  noteId?: string,
): Promise<Response> {
  const selected = await readSelected(ctx.state.api)
  if (selected !== groupId) return ctx.redirect(SCREEN_PATHS.groups, 303)
  return ctx.redirect(noteId ? NOTE_PATHS.note(noteId) : NOTE_PATHS.list, 303)
}

/**
 * The id of the person's selected group, or the answer to give when there is none: the notes page
 * with "This group was not found". A person with no group is the only way to get there.
 */
export async function selectedGroupOrPage(
  ctx: FreshContext<State>,
): Promise<{ groupId: string } | { page: Response }> {
  const groupId = await readSelected(ctx.state.api)
  return groupId ? { groupId } : { page: await renderNotes(ctx) }
}

/** Who the person is and which group the notes pages show, or the sign-in redirect to give. */
async function readPage(
  ctx: FreshContext<State>,
): Promise<
  Response | { session: Session; group: NotesGroup | null; moveTargets: MoveTarget[] }
> {
  const { api } = ctx.state
  const session = await readSession(api)
  if (!session.user) return ctx.redirect(signInPath(session, ctx.req), 303)
  const picker = session.picker
  // The picker holds one page of groups; a person with more may have selected one beyond it.
  const membership = picker?.selectedId
    ? picker.groups.find((group) => group.id === picker.selectedId) ??
      await readGroup(api, picker.selectedId)
    : null
  const group: NotesGroup | null = membership
    ? { id: membership.id, name: membership.name, canWrite: canMutateNotes(membership.role) }
    : null
  // The groups the picker lists, where the person may write: the places a note can move to.
  const moveTargets = group?.canWrite ? moveTargetsOf(picker?.groups ?? [], group.id) : []
  return { session, group, moveTargets }
}

/**
 * The notes page: the selected group's notes, a page at a time (`?cursor=`). The group is the one
 * the server holds for the person, so the address names none. A person with no group sees "This
 * group was not found".
 */
export async function renderNotes(
  ctx: FreshContext<State>,
  page: NotesPageState = {},
): Promise<Response> {
  const read = await readPage(ctx)
  if (read instanceof Response) return read
  const { session, group, moveTargets } = read
  const cursor = ctx.url.searchParams.get("cursor")
  const list = group
    ? await listNotes(ctx.state.api, group.id, cursor)
    : { notes: [], nextCursor: null, error: null }
  return ctx.render(
    <Frame session={session} path={ctx.url.pathname}>
      <NotesScreen
        group={group}
        notes={list.notes}
        loading={false}
        listError={page.listError ?? list.error}
        moveTargets={moveTargets}
        moveError={page.moveError}
        nextPageHref={list.nextCursor
          ? `${NOTE_PATHS.list}?${new URLSearchParams({ cursor: list.nextCursor })}`
          : null}
      />
    </Frame>,
    { status: page.status ?? (group ? 200 : 404) },
  )
}

/** What the note page shows besides the note: the typed text, the errors of the last post. */
export interface NoteEditorPageState {
  /** The note being edited; `null` for the create page. */
  note?: NoteTarget | null
  value?: NoteDraft
  draftId?: string
  errors?: NoteFormErrors
  /** The note could not be read, so the page says it was not found. */
  notFound?: boolean
  /** Show "delete this note?" in place of the form. */
  confirmingDelete?: boolean
  /** The refusal of a move, shown in the note page's move form. */
  moveError?: string | null
  status?: number
}

/**
 * The note page: the create form, or the edit form of `note`, or "not found", or the question
 * "delete this note?". For a viewer it is the note as text. The group is the selected one.
 */
export async function renderNoteEditor(
  ctx: FreshContext<State>,
  page: NoteEditorPageState = {},
): Promise<Response> {
  const read = await readPage(ctx)
  if (read instanceof Response) return read
  const { session, group, moveTargets } = read
  const notFound = page.notFound ?? false
  return ctx.render(
    <Frame session={session} path={ctx.url.pathname}>
      <NoteEditorScreen
        group={group}
        loading={false}
        notFound={notFound}
        note={page.note ?? null}
        value={page.value ?? { title: "", body: "" }}
        draftId={page.draftId ?? crypto.randomUUID()}
        errors={page.errors ?? NO_ERRORS}
        saving={false}
        deleting={false}
        confirmingDelete={page.confirmingDelete}
        moveTargets={moveTargets}
        moveError={page.moveError}
      />
    </Frame>,
    { status: page.status ?? (group && !notFound ? 200 : 404) },
  )
}

/**
 * Reads a note of the selected group and renders its page: the edit form, or with `confirming` the
 * delete question. `errors` is a refusal of the post that led here, shown on the page. A note that
 * cannot be read (gone, or in another group) is the not-found page; a person never gets to a note
 * of another group by a link, because a link must not change the selection.
 */
export async function renderNoteOfSelectedGroup(
  ctx: FreshContext<State>,
  groupId: string,
  noteId: string,
  options: {
    confirming?: boolean
    errors?: NoteFormErrors
    moveError?: string
    status?: number
  } = {},
): Promise<Response> {
  const answer = await ctx.state.api.call("GET", notesApiPath(groupId, noteId))
  const note = noteOf(answer)
  if (!note) {
    return renderNoteEditor(ctx, {
      notFound: true,
      errors: answer.status === 404
        ? options.errors
        : { title: null, form: errorMessage(answer, "The note could not be read") },
      status: answer.status === 404 || answer.status === 403 ? 404 : answer.status,
    })
  }
  return renderNoteEditor(ctx, {
    note: { id: note.id, version: note.version, conflict: false },
    value: { title: note.title, body: note.body },
    errors: options.errors,
    confirmingDelete: options.confirming,
    moveError: options.moveError,
    status: options.status,
  })
}

/** The form error of a refused note write, and whether it was a stale version. */
export function refusal(answer: ApiAnswer, fallback: string) {
  return {
    errors: { title: null, form: errorMessage(answer, fallback), plan: planRefusalOf(answer) },
    conflict: errorCode(answer) === "VERSION_CONFLICT",
  }
}
