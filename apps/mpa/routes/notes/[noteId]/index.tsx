import { NOTE_PATHS } from "@ui/progressive.tsx"
import { errorMessage, isOk } from "../../../api.ts"
import { API_BODIES, readForm } from "../../../forms.ts"
import { noteOf, notesApiPath, refusal, renderNotes, selectedGroupOrPage } from "../../../notes.tsx"
import { define } from "../../../utils.ts"

/**
 * One note's edit page, in the selected group: `GET` opens the edit form at the note's current
 * version, `POST` saves it. A save against a version that moved on keeps the typed text and links
 * to the latest version.
 */
export const handler = define.handlers({
  async GET(ctx) {
    const selected = await selectedGroupOrPage(ctx)
    if ("page" in selected) return selected.page
    const answer = await ctx.state.api.call(
      "GET",
      notesApiPath(selected.groupId, ctx.params.noteId),
    )
    const note = noteOf(answer)
    if (!note) {
      return renderNotes(ctx, {
        listError: errorMessage(answer, "The note could not be read"),
        status: answer.status,
      })
    }
    return renderNotes(ctx, { editing: { ...note, conflict: false } })
  },
  async POST(ctx) {
    const selected = await selectedGroupOrPage(ctx)
    if ("page" in selected) return selected.page
    const { noteId } = ctx.params
    const body = API_BODIES.noteUpdate(await readForm(ctx.req))
    const answer = await ctx.state.api.call(
      "PATCH",
      notesApiPath(selected.groupId, noteId),
      body,
    )
    if (isOk(answer)) return ctx.redirect(NOTE_PATHS.list, 303)
    const { errors, conflict } = refusal(answer, "The note could not be saved")
    return renderNotes(ctx, {
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
