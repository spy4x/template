import { errorMessage, isOk } from "../../api.ts"
import { API_BODIES, readForm } from "../../forms.ts"
import { renderGroups } from "../../groups-page.tsx"
import { define } from "../../utils.ts"

/** The groups page: `GET` lists the person's groups, `POST` creates one. */
export const handler = define.handlers({
  GET: (ctx) => renderGroups(ctx),
  async POST(ctx) {
    const form = await readForm(ctx.req)
    const body = API_BODIES.groupCreate(form)
    const answer = await ctx.state.api.call("POST", "/api/groups", body)
    if (isOk(answer)) return ctx.redirect("/groups", 303)
    return renderGroups(ctx, {
      draftId: body.id,
      name: body.name,
      error: errorMessage(answer, "Group creation failed"),
      status: answer.status,
    })
  },
})
