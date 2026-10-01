import { NOTE_PATHS } from "@ui/progressive.tsx"
import { errorMessage, isOk } from "../../../api.ts"
import { API_BODIES, readForm } from "../../../forms.ts"
import { notesApiPath, renderNoteOfSelectedGroup, selectedGroupOrPage } from "../../../notes.tsx"
import { define } from "../../../utils.ts"

/**
 * Deleting a note without JavaScript. `GET` asks "delete this note?" on a page of its own, with a
 * form that posts the version the person saw. `POST` deletes at that version and returns to the
 * list. A refusal shows the note's page as it is now, with the error: a stale version is never
 * asked about again with the same version.
 */
export const handler = define.handlers({
  async GET(ctx) {
    const selected = await selectedGroupOrPage(ctx)
    if ("page" in selected) return selected.page
    return renderNoteOfSelectedGroup(ctx, selected.groupId, ctx.params.noteId, { confirming: true })
  },
  async POST(ctx) {
    const selected = await selectedGroupOrPage(ctx)
    if ("page" in selected) return selected.page
    const { noteId } = ctx.params
    const body = API_BODIES.noteDelete(await readForm(ctx.req))
    const answer = await ctx.state.api.call("DELETE", notesApiPath(selected.groupId, noteId), body)
    if (isOk(answer)) return ctx.redirect(NOTE_PATHS.list, 303)
    return renderNoteOfSelectedGroup(ctx, selected.groupId, noteId, {
      errors: { title: null, form: errorMessage(answer, "The note could not be deleted") },
      status: answer.status,
    })
  },
})
