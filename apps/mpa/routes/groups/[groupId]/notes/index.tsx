import { NOTE_PATHS } from "@ui/progressive.tsx"
import { isOk } from "../../../../api.ts"
import { API_BODIES, readForm } from "../../../../forms.ts"
import { notesApiPath, refusal, renderNotes } from "../../../../notes.tsx"
import { define } from "../../../../utils.ts"

/** A group's notes: `GET` lists them with the create form, `POST` creates one. */
export const handler = define.handlers({
  GET: (ctx) => renderNotes(ctx, ctx.params.groupId),
  async POST(ctx) {
    const { groupId } = ctx.params
    const body = API_BODIES.noteCreate(await readForm(ctx.req))
    const answer = await ctx.state.api.call("POST", notesApiPath(groupId), body)
    if (isOk(answer)) return ctx.redirect(NOTE_PATHS.list(groupId), 303)
    // The same id again: sending the kept form twice cannot create the note twice.
    return renderNotes(ctx, groupId, {
      draftId: body.id,
      draft: { title: body.title, body: body.body },
      createErrors: refusal(answer, "The note could not be added").errors,
      status: answer.status,
    })
  },
})
