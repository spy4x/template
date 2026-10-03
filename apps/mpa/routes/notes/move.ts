import { NOTE_PATHS } from "@ui/progressive.tsx"
import { errorMessage, isOk } from "../../api.ts"
import { API_BODIES, readForm } from "../../forms.ts"
import { notesApiPath, renderNotes, selectedGroupOrPage } from "../../notes.tsx"
import { define } from "../../utils.ts"

/**
 * Moving the ticked notes of the list to another group without JavaScript: `POST` takes
 * `{ toGroupId, noteIds }`, all or none, and returns to the list. Like the create form, the post
 * names the group the page showed (`?group=`), and is refused when another device has switched the
 * selection since: the ticked notes are not the ones of the group now on screen.
 */
export const handler = define.handlers({
  async POST(ctx) {
    const selected = await selectedGroupOrPage(ctx)
    if ("page" in selected) return selected.page
    const body = API_BODIES.noteMoveMany(await readForm(ctx.req))
    if (ctx.url.searchParams.get("group") !== selected.groupId) {
      return renderNotes(ctx, {
        moveError: "Your selected group changed since this page was drawn. Nothing was moved.",
        status: 409,
      })
    }
    if (body.noteIds.length === 0) {
      return renderNotes(ctx, { moveError: "Tick the notes you want to move.", status: 400 })
    }
    const answer = await ctx.state.api.call("POST", `${notesApiPath(selected.groupId)}/move`, body)
    if (isOk(answer)) return ctx.redirect(NOTE_PATHS.list, 303)
    return renderNotes(ctx, {
      moveError: errorMessage(answer, "The notes could not be moved"),
      status: answer.status,
    })
  },
})
