import { SCREEN_PATHS } from "@ui/progressive.tsx"
import { errorMessage, isOk } from "../../../api.ts"
import { renderGroups } from "../../../groups-page.tsx"
import { define } from "../../../utils.ts"

/**
 * Restores a deleted group (`POST /api/groups/:groupId/restore`) and shows the groups page; a
 * refusal, such as a group deleted more than 30 days ago, shows above the deleted groups.
 */
export const handler = define.handlers({
  async POST(ctx) {
    const answer = await ctx.state.api.call(
      "POST",
      `/api/groups/${encodeURIComponent(ctx.params.groupId)}/restore`,
    )
    if (isOk(answer)) return ctx.redirect(SCREEN_PATHS.groups, 303)
    return renderGroups(ctx, {
      restoreError: errorMessage(answer, "The group could not be restored"),
      status: answer.status,
    })
  },
})
