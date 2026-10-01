import { SCREEN_PATHS } from "@ui/progressive.tsx"
import { errorMessage, isOk } from "../../../api.ts"
import { renderGroupSettings } from "../../../group-settings.tsx"
import { define } from "../../../utils.ts"

/**
 * Deletes the group (`DELETE /api/groups/:groupId`), softly. It then shows the groups page, where
 * the group waits to be restored; a refusal, such as the person's last group, shows on the
 * settings page.
 */
export const handler = define.handlers({
  async POST(ctx) {
    const answer = await ctx.state.api.call(
      "DELETE",
      `/api/groups/${encodeURIComponent(ctx.params.groupId)}`,
    )
    if (isOk(answer)) return ctx.redirect(SCREEN_PATHS.groups, 303)
    return renderGroupSettings(ctx, {
      deleteError: errorMessage(answer, "The group could not be deleted"),
      status: answer.status,
    })
  },
})
