import { GROUP_PATHS } from "@ui/progressive.tsx"
import { errorMessage, isOk } from "../../../../../api.ts"
import { renderGroupSettings } from "../../../../../group-settings.tsx"
import { define } from "../../../../../utils.ts"

/**
 * Revokes a pending invitation (`DELETE /api/groups/:groupId/invitations/:invitationId`); a refusal
 * shows under that invitation's row.
 */
export const handler = define.handlers({
  async POST(ctx) {
    const { groupId, invitationId } = ctx.params
    const answer = await ctx.state.api.call(
      "DELETE",
      `/api/groups/${encodeURIComponent(groupId)}/invitations/${encodeURIComponent(invitationId)}`,
    )
    if (isOk(answer)) return ctx.redirect(GROUP_PATHS.settings(groupId), 303)
    return renderGroupSettings(ctx, {
      revokeError: {
        invitationId,
        message: errorMessage(answer, "The invitation could not be revoked"),
      },
      status: answer.status,
    })
  },
})
