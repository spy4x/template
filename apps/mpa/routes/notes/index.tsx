import { NOTE_PATHS } from "@ui/progressive.tsx"
import { isOk } from "../../api.ts"
import { API_BODIES, readForm } from "../../forms.ts"
import { notesApiPath, refusal, renderNotes, selectedGroupOrPage } from "../../notes.tsx"
import { define } from "../../utils.ts"

/** The selected group's notes: `GET` lists them with the create form, `POST` creates one. */
export const handler = define.handlers({
  GET: (ctx) => renderNotes(ctx),
  async POST(ctx) {
    const selected = await selectedGroupOrPage(ctx)
    if ("page" in selected) return selected.page
    const body = API_BODIES.noteCreate(await readForm(ctx.req))
    // The page the form came from named its group; another device may have switched since.
    if (ctx.url.searchParams.get("group") !== selected.groupId) {
      return renderNotes(ctx, {
        draftId: body.id,
        draft: { title: body.title, body: body.body },
        createErrors: {
          title: null,
          form: "Your selected group changed since this page was drawn. Nothing was added.",
        },
        status: 409,
      })
    }
    const answer = await ctx.state.api.call("POST", notesApiPath(selected.groupId), body)
    if (isOk(answer)) return ctx.redirect(NOTE_PATHS.list, 303)
    // The same id again: sending the kept form twice cannot create the note twice.
    return renderNotes(ctx, {
      draftId: body.id,
      draft: { title: body.title, body: body.body },
      createErrors: refusal(answer, "The note could not be added").errors,
      status: answer.status,
    })
  },
})
