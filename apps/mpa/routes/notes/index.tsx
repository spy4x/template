import { NOTE_PATHS } from "@ui/progressive.tsx"
import { isOk } from "../../api.ts"
import { API_BODIES, readForm } from "../../forms.ts"
import {
  notesApiPath,
  refusal,
  renderNoteEditor,
  renderNotes,
  selectedGroupOrPage,
} from "../../notes.tsx"
import { define } from "../../utils.ts"

/**
 * The selected group's notes: `GET` lists them, `POST` creates one from the create page's form and
 * opens its page. A refusal shows the create form again with the typed text.
 */
export const handler = define.handlers({
  GET: (ctx) => renderNotes(ctx),
  async POST(ctx) {
    const selected = await selectedGroupOrPage(ctx)
    if ("page" in selected) return selected.page
    const body = API_BODIES.noteCreate(await readForm(ctx.req))
    const again = (form: string, status: number) =>
      renderNoteEditor(ctx, {
        draftId: body.id,
        value: { title: body.title, body: body.body },
        errors: { title: null, form },
        status,
      })
    // The page the form came from named its group; another device may have switched since.
    if (ctx.url.searchParams.get("group") !== selected.groupId) {
      return again("Your selected group changed since this page was drawn. Nothing was added.", 409)
    }
    const answer = await ctx.state.api.call("POST", notesApiPath(selected.groupId), body)
    if (isOk(answer)) return ctx.redirect(NOTE_PATHS.note(body.id), 303)
    // The same id again: sending the kept form twice cannot create the note twice.
    return renderNoteEditor(ctx, {
      draftId: body.id,
      value: { title: body.title, body: body.body },
      errors: refusal(answer, "The note could not be added").errors,
      status: answer.status,
    })
  },
})
