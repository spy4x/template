import { GROUP_PATHS } from "@ui/progressive.tsx"
import { errorMessage, isOk } from "../../../../../api.ts"
import { API_BODIES, readForm } from "../../../../../forms.ts"
import { renderGroupSettings } from "../../../../../group-settings.tsx"
import { define } from "../../../../../utils.ts"

/**
 * Gives a member a new role (`PATCH /api/groups/:groupId/members/:userId`); a refusal shows under
 * that member's row.
 */
export const handler = define.handlers({
  async POST(ctx) {
    const { groupId, userId } = ctx.params
    const answer = await ctx.state.api.call(
      "PATCH",
      `/api/groups/${encodeURIComponent(groupId)}/members/${encodeURIComponent(userId)}`,
      API_BODIES.groupMemberRole(await readForm(ctx.req)),
    )
    if (isOk(answer)) return ctx.redirect(GROUP_PATHS.settings(groupId), 303)
    return renderGroupSettings(ctx, {
      memberError: {
        userId: Number(userId),
        message: errorMessage(answer, "The role could not be changed"),
      },
      status: answer.status,
    })
  },
})
