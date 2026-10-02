import type { FreshContext } from "fresh"
import { type GroupBilling, providerPageUrl, readGroupBilling } from "@domain/billing"
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
  if (!isOk(answer) || !isRecord(answer.body)) return null
  return readGroupBilling(answer.body.billing)
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
