import { NOTE_PATHS } from "@ui/progressive.tsx"
import { errorMessage, isOk } from "../../../../../api.ts"
import { API_BODIES, readForm } from "../../../../../forms.ts"
import { notesApiPath, renderNotes } from "../../../../../notes.tsx"
import { define } from "../../../../../utils.ts"

/** Deletes a note at the version the person saw; a refusal shows above the list. */
export const handler = define.handlers({
  async POST(ctx) {
    const { groupId, noteId } = ctx.params
    const body = API_BODIES.noteDelete(await readForm(ctx.req))
    const answer = await ctx.state.api.call("DELETE", notesApiPath(groupId, noteId), body)
    if (isOk(answer)) return ctx.redirect(NOTE_PATHS.list(groupId), 303)
    return renderNotes(ctx, groupId, {
      listError: errorMessage(answer, "The note could not be deleted"),
      status: answer.status,
    })
  },
})
