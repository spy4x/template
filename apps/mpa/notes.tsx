import type { FreshContext } from "fresh"
import { canMutateNotes } from "@domain/groups"
import {
  type NoteDraft,
  type NoteEdit,
  type NoteFormErrors,
  type NoteRow,
  NotesScreen,
} from "@ui/notes-screen.tsx"
import { NOTE_PATHS, SCREEN_PATHS } from "@ui/progressive.tsx"
import { type Api, type ApiAnswer, errorCode, errorMessage, isOk, isRecord } from "./api.ts"
import { readGroup, readSelected } from "./groups.ts"
import { Frame, readSession, signInPath } from "./session.tsx"
import type { State } from "./utils.ts"

const NO_ERRORS: NoteFormErrors = { title: null, form: null }

/** What a notes page shows besides the list: the open form and the errors of the last post. */
export interface NotesPageState {
  draftId?: string
  draft?: NoteDraft
  createErrors?: NoteFormErrors
  editing?: NoteEdit | null
  editErrors?: NoteFormErrors
  listError?: string | null
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

/**
 * The notes page: the selected group's notes, a page at a time (`?cursor=`), with the create form
 * or, with `editing`, the edit form. The group is the one the server holds for the person, so the
 * address names none. A person with no group sees "This group was not found".
 */
export async function renderNotes(
  ctx: FreshContext<State>,
  page: NotesPageState = {},
): Promise<Response> {
  const { api } = ctx.state
  const session = await readSession(api)
  if (!session.user) return ctx.redirect(signInPath(session), 303)
  const picker = session.picker
  // The picker holds one page of groups; a person with more may have selected one beyond it.
  const membership = picker?.selectedId
    ? picker.groups.find((group) => group.id === picker.selectedId) ??
      await readGroup(api, picker.selectedId)
    : null
  const cursor = ctx.url.searchParams.get("cursor")
  const list = membership
    ? await listNotes(api, membership.id, cursor)
    : { notes: [], nextCursor: null, error: null }
  return ctx.render(
    <Frame session={session} path={ctx.url.pathname}>
      <NotesScreen
        group={membership
          ? { id: membership.id, name: membership.name, canWrite: canMutateNotes(membership.role) }
          : null}
        notes={list.notes}
        loading={false}
        draftId={page.draftId ?? crypto.randomUUID()}
        draft={page.draft ?? { title: "", body: "" }}
        createErrors={page.createErrors ?? NO_ERRORS}
        creating={false}
        editing={page.editing ?? null}
        editErrors={page.editErrors ?? NO_ERRORS}
        saving={false}
        deleting={null}
        listError={page.listError ?? list.error}
        nextPageHref={list.nextCursor
          ? `${NOTE_PATHS.list}?${new URLSearchParams({ cursor: list.nextCursor })}`
          : null}
      />
    </Frame>,
    { status: page.status ?? (membership ? 200 : 404) },
  )
}

/** The form error of a refused note write, and whether it was a stale version. */
export function refusal(answer: ApiAnswer, fallback: string) {
  return {
    errors: { title: null, form: errorMessage(answer, fallback) },
    conflict: errorCode(answer) === "VERSION_CONFLICT",
  }
}
