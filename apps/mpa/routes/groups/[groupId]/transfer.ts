import { GROUP_PATHS } from "@ui/progressive.tsx"
import { transferErrorField } from "@ui/group-transfer.tsx"
import { errorMessage, isOk, isRecord } from "../../../api.ts"
import { API_BODIES, readForm } from "../../../forms.ts"
import { renderGroupSettings } from "../../../group-settings.tsx"
import { define } from "../../../utils.ts"

/**
 * Hands the group to another member (`POST /api/groups/:groupId/transfer`) and shows the settings
 * again, now as an admin. A refusal shows under the field it is about, with the chosen member and
 * the typed name kept and the password left out.
 */
export const handler = define.handlers({
  async POST(ctx) {
    const { groupId } = ctx.params
    const body = API_BODIES.groupTransfer(await readForm(ctx.req))
    const answer = await ctx.state.api.call(
      "POST",
      `/api/groups/${encodeURIComponent(groupId)}/transfer`,
      body,
    )
    if (isOk(answer)) return ctx.redirect(GROUP_PATHS.settings(groupId), 303)
    const error = isRecord(answer.body) && isRecord(answer.body.error) ? answer.body.error : null
    return renderGroupSettings(ctx, {
      transferDraft: {
        userId: typeof body.userId === "number" ? body.userId : null,
        name: body.name,
        password: "",
      },
      transferError: {
        field: transferErrorField(typeof error?.code === "string" ? error.code : undefined),
        message: errorMessage(answer, "The group could not be transferred"),
      },
      status: answer.status,
      retryAfter: answer.retryAfter,
    })
  },
})
