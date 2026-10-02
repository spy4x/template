import { errorMessage, isOk } from "../../../../api.ts"
import { redirectUrl, renderPricing } from "../../../../billing.tsx"
import { API_BODIES, readForm } from "../../../../forms.ts"
import { define } from "../../../../utils.ts"

/**
 * Opens the provider's checkout for the chosen plan (`POST /api/groups/:groupId/billing/checkout`)
 * and sends the browser there; a refusal shows under the plans.
 */
export const handler = define.handlers({
  async POST(ctx) {
    const { groupId } = ctx.params
    const answer = await ctx.state.api.call(
      "POST",
      `/api/groups/${encodeURIComponent(groupId)}/billing/checkout`,
      API_BODIES.billingCheckout(await readForm(ctx.req)),
    )
    const url = isOk(answer) ? redirectUrl(answer.body) : null
    if (url) return new Response(null, { status: 303, headers: { location: url } })
    return renderPricing(ctx, {
      error: errorMessage(answer, "The checkout could not be opened"),
      status: isOk(answer) ? 502 : answer.status,
    })
  },
})
