import { NOTE_PATHS } from "@ui/progressive.tsx"
import { errorMessage, isOk } from "../../../../../api.ts"
import { API_BODIES, readForm } from "../../../../../forms.ts"
import { noteOf, notesApiPath, refusal, renderNotes } from "../../../../../notes.tsx"
import { define } from "../../../../../utils.ts"

/**
 * One note's edit page: `GET` opens the edit form at the note's current version, `POST` saves it.
 * A save against a version that moved on keeps the typed text and links to the latest version.
 */
export const handler = define.handlers({
  async GET(ctx) {
    const { groupId, noteId } = ctx.params
    const answer = await ctx.state.api.call("GET", notesApiPath(groupId, noteId))
    const note = noteOf(answer)
    if (!note) {
      return renderNotes(ctx, groupId, {
        listError: errorMessage(answer, "The note could not be read"),
        status: answer.status,
      })
    }
    return renderNotes(ctx, groupId, { editing: { ...note, conflict: false } })
  },
  async POST(ctx) {
    const { groupId, noteId } = ctx.params
    const body = API_BODIES.noteUpdate(await readForm(ctx.req))
    const answer = await ctx.state.api.call("PATCH", notesApiPath(groupId, noteId), body)
    if (isOk(answer)) return ctx.redirect(NOTE_PATHS.list(groupId), 303)
    const { errors, conflict } = refusal(answer, "The note could not be saved")
    return renderNotes(ctx, groupId, {
      editing: {
        id: noteId,
        title: body.title,
        body: body.body,
        version: typeof body.version === "number" ? body.version : 0,
        conflict,
      },
      editErrors: errors,
      status: answer.status,
    })
  },
})
