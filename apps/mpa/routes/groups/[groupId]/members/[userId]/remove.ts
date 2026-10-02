import { GROUP_PATHS } from "@ui/progressive.tsx"
import { errorMessage, isOk } from "../../../../../api.ts"
import { renderGroupSettings } from "../../../../../group-settings.tsx"
import { define } from "../../../../../utils.ts"

/**
 * Removes a member from the group (`DELETE /api/groups/:groupId/members/:userId`); a refusal shows
 * under that member's row.
 */
export const handler = define.handlers({
  async POST(ctx) {
    const { groupId, userId } = ctx.params
    const answer = await ctx.state.api.call(
      "DELETE",
      `/api/groups/${encodeURIComponent(groupId)}/members/${encodeURIComponent(userId)}`,
    )
    if (isOk(answer)) return ctx.redirect(GROUP_PATHS.settings(groupId), 303)
    return renderGroupSettings(ctx, {
      memberError: {
        userId: Number(userId),
        message: errorMessage(answer, "The member could not be removed"),
      },
      status: answer.status,
    })
  },
})
