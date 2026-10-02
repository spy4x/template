import { SCREEN_PATHS } from "@ui/progressive.tsx"
import { errorMessage, isOk } from "../../../api.ts"
import { renderGroupSettings } from "../../../group-settings.tsx"
import { define } from "../../../utils.ts"

/**
 * Leaves the group (`POST /api/groups/:groupId/leave`) and shows the groups page; a refusal, such
 * as the person's only group, shows on the settings page.
 */
export const handler = define.handlers({
  async POST(ctx) {
    const answer = await ctx.state.api.call(
      "POST",
      `/api/groups/${encodeURIComponent(ctx.params.groupId)}/leave`,
    )
    if (isOk(answer)) return ctx.redirect(SCREEN_PATHS.groups, 303)
    return renderGroupSettings(ctx, {
      leaveError: errorMessage(answer, "The group could not be left"),
      status: answer.status,
    })
  },
})
