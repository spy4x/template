import { GROUP_PATHS } from "@ui/progressive.tsx"
import { errorMessage, isOk } from "../../../api.ts"
import { API_BODIES, readForm } from "../../../forms.ts"
import { renderGroupSettings } from "../../../group-settings.tsx"
import { define } from "../../../utils.ts"

/** Renames the group (`PATCH /api/groups/:groupId`); a refusal shows under the name field. */
export const handler = define.handlers({
  async POST(ctx) {
    const { groupId } = ctx.params
    const body = API_BODIES.groupRename(await readForm(ctx.req))
    const answer = await ctx.state.api.call(
      "PATCH",
      `/api/groups/${encodeURIComponent(groupId)}`,
      body,
    )
    if (isOk(answer)) return ctx.redirect(GROUP_PATHS.settings(groupId), 303)
    return renderGroupSettings(ctx, {
      name: body.name,
      renameError: errorMessage(answer, "The group could not be renamed"),
      status: answer.status,
    })
  },
})
