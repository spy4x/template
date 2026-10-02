import type { FreshContext } from "fresh"
import { BillingStatus, type GroupBilling, providerPageUrl } from "@domain/billing"
import { PricingScreen } from "@ui/billing-screen.tsx"
import { type Api, isOk, isRecord } from "./api.ts"
import { readGroup } from "./groups.ts"
import { Frame, readSession, signInPath } from "./session.tsx"
import type { State } from "./utils.ts"

/**
 * A group's billing (`GET /api/groups/:groupId/billing`), or `null` when the read failed or the
 * person is not a member.
 */
export async function readBilling(api: Api, groupId: string): Promise<GroupBilling | null> {
  const answer = await api.call("GET", `/api/groups/${encodeURIComponent(groupId)}/billing`)
  if (!isOk(answer) || !isRecord(answer.body) || !isRecord(answer.body.billing)) return null
  const billing = answer.body.billing
  const { enabled, planId, status, currentPeriodEnd, cancelAtPeriodEnd, canManage } = billing
  const { subscribed, hasCustomer } = billing
  if (
    typeof enabled !== "boolean" || typeof planId !== "string" ||
    typeof cancelAtPeriodEnd !== "boolean" || typeof canManage !== "boolean" ||
    typeof subscribed !== "boolean" || typeof hasCustomer !== "boolean" ||
    !(status === null || (typeof status === "number" && status in BillingStatus)) ||
    !(currentPeriodEnd === null || typeof currentPeriodEnd === "string")
  ) {
    return null
  }
  return {
    enabled,
    planId,
    status: status as BillingStatus | null,
    currentPeriodEnd: currentPeriodEnd === null ? null : new Date(currentPeriodEnd),
    cancelAtPeriodEnd,
    canManage,
    subscribed,
    hasCustomer,
  }
}

/** The provider page an answer of checkout or portal names, or `null`. */
export function redirectUrl(body: unknown): string | null {
  return isRecord(body) ? providerPageUrl(body.url) : null
}

/** The plans page, for the `GET` and for a refused checkout, which shows why under the plans. */
export async function renderPricing(
  ctx: FreshContext<State>,
  { error = null, status }: { error?: string | null; status?: number } = {},
): Promise<Response> {
  const session = await readSession(ctx.state.api)
  if (!session.user) return ctx.redirect(signInPath(session, ctx.req), 303)
  const { groupId } = ctx.params
  const [group, billing] = await Promise.all([
    readGroup(ctx.state.api, groupId),
    readBilling(ctx.state.api, groupId),
  ])
  return ctx.render(
    <Frame session={session} path={ctx.url.pathname}>
      <PricingScreen
        groupId={groupId}
        groupName={group?.name ?? null}
        billing={billing}
        error={error ?? (billing ? null : "The plans could not be read")}
      />
    </Frame>,
    { status: status ?? (billing ? 200 : 404) },
  )
}
