import { NOTE_PATHS } from "@ui/progressive.tsx"
import { errorMessage, isOk } from "../../../api.ts"
import { API_BODIES, readForm } from "../../../forms.ts"
import { notesApiPath, renderNoteOfSelectedGroup, selectedGroupOrPage } from "../../../notes.tsx"
import { define } from "../../../utils.ts"

/**
 * Moving one note to another group without JavaScript: `POST` takes `{ toGroupId }` from the move
 * form on the note's page and returns to the list, which no longer has the note. A refusal shows
 * the note's page again with the reason under the move form.
 */
export const handler = define.handlers({
  async POST(ctx) {
    const selected = await selectedGroupOrPage(ctx)
    if ("page" in selected) return selected.page
    const { noteId } = ctx.params
    const body = API_BODIES.noteMoveOne(await readForm(ctx.req), noteId)
    const answer = await ctx.state.api.call("POST", `${notesApiPath(selected.groupId)}/move`, body)
    if (isOk(answer)) return ctx.redirect(NOTE_PATHS.list, 303)
    return renderNoteOfSelectedGroup(ctx, selected.groupId, noteId, {
      moveError: errorMessage(answer, "The note could not be moved"),
      status: answer.status,
    })
  },
})
