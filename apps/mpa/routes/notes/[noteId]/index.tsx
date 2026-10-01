import { NOTE_PATHS } from "@ui/progressive.tsx"
import { isOk } from "../../../api.ts"
import { API_BODIES, readForm } from "../../../forms.ts"
import {
  notesApiPath,
  refusal,
  renderNoteEditor,
  renderNoteOfSelectedGroup,
  selectedGroupOrPage,
} from "../../../notes.tsx"
import { define } from "../../../utils.ts"

/**
 * One note's page, in the selected group: `GET` opens the edit form at the note's current version
 * (a viewer sees the note as text, a note that is not in this group is "not found"), `POST` saves
 * it and returns to the list. A save against a version that moved on keeps the typed text and
 * links to the latest version.
 */
export const handler = define.handlers({
  async GET(ctx) {
    const selected = await selectedGroupOrPage(ctx)
    if ("page" in selected) return selected.page
    return renderNoteOfSelectedGroup(ctx, selected.groupId, ctx.params.noteId)
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
    return renderNoteEditor(ctx, {
      note: {
        id: noteId,
        version: typeof body.version === "number" ? body.version : 0,
        conflict,
      },
      value: { title: body.title, body: body.body },
      errors,
      status: answer.status,
    })
  },
})
