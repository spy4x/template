import { NOTE_PATHS } from "@ui/progressive.tsx"
import { errorMessage, isOk } from "../../../api.ts"
import { API_BODIES, readForm } from "../../../forms.ts"
import { notesApiPath, renderNotes, selectedGroupOrPage } from "../../../notes.tsx"
import { define } from "../../../utils.ts"

/** Deletes a note of the selected group at the version the person saw; a refusal shows above the list. */
export const handler = define.handlers({
  async POST(ctx) {
    const selected = await selectedGroupOrPage(ctx)
    if ("page" in selected) return selected.page
    const body = API_BODIES.noteDelete(await readForm(ctx.req))
    const answer = await ctx.state.api.call(
      "DELETE",
      notesApiPath(selected.groupId, ctx.params.noteId),
      body,
    )
    if (isOk(answer)) return ctx.redirect(NOTE_PATHS.list, 303)
    return renderNotes(ctx, {
      listError: errorMessage(answer, "The note could not be deleted"),
      status: answer.status,
    })
  },
})
