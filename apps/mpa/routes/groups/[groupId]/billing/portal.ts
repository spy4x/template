import { errorMessage, isOk } from "../../../../api.ts"
import { redirectUrl } from "../../../../billing.tsx"
import { renderGroupSettings } from "../../../../group-settings.tsx"
import { define } from "../../../../utils.ts"

/**
 * Opens the provider's portal (`POST /api/groups/:groupId/billing/portal`) and sends the browser
 * there; a refusal shows in the plan section of the group's settings.
 */
export const handler = define.handlers({
  async POST(ctx) {
    const { groupId } = ctx.params
    const answer = await ctx.state.api.call(
      "POST",
      `/api/groups/${encodeURIComponent(groupId)}/billing/portal`,
    )
    const url = isOk(answer) ? redirectUrl(answer.body) : null
    if (url) return new Response(null, { status: 303, headers: { location: url } })
    return renderGroupSettings(ctx, {
      billingError: errorMessage(answer, "The billing portal could not be opened"),
      status: isOk(answer) ? 502 : answer.status,
    })
  },
})
