import type { CommandHandler, QueryHandler } from "@spy4x/platform/cqrs"
import type { BillingProvider } from "@spy4x/billing"
import {
  assertCanManageBilling,
  assertCanReadBilling,
  BillingCheckoutCommand,
  BillingError,
  BillingGetQuery,
  BillingPortalCommand,
  type BillingRepository,
  effectivePlanId,
  FREE_PLAN_ID,
  type GroupRoleLookup,
  PAID_PLANS,
  toGroupBilling,
} from "@domain/billing"

/** What every billing handler needs. */
export interface BillingHandlerDependencies {
  billing: BillingRepository
  groups: GroupRoleLookup
  /** `null` when this deployment takes no payments. */
  provider: BillingProvider | null
  /** The web app's own URL, such as `https://app.example.com`: where the provider sends people back. */
  webAppUrl: string
  /** Where a provider failure is written; the person sees only `PROVIDER_ERROR`. */
  log: (message: string, detail?: unknown) => void
}

/**
 * The billing handlers. Any member reads the group's plan; only the owner opens checkout or the
 * portal, and a stranger is told the group does not exist. The role is read from Postgres on every
 * call, never from a cache.
 */
export function createBillingGetHandler(
  { billing, groups, provider }: BillingHandlerDependencies,
): QueryHandler<BillingGetQuery> {
  return async ({ data }) => {
    const role = await groups.roleOf(data.groupId, data.actor.userId)
    assertCanReadBilling(role)
    const subscription = provider ? await billing.get(data.groupId) : null
    return { billing: toGroupBilling(subscription, role, provider !== null) }
  }
}

export function createBillingCheckoutHandler(
  dependencies: BillingHandlerDependencies,
): CommandHandler<BillingCheckoutCommand> {
  return async ({ data }) => {
    const provider = await authorize(dependencies, data.groupId, data.actor.userId)
    if (!PAID_PLANS.some((plan) => plan.id === data.planId)) {
      throw new BillingError("UNKNOWN_PLAN", "No such plan")
    }
    // A second checkout would start a second subscription and charge twice; the portal changes the
    // plan of the one the group has.
    const current = await dependencies.billing.get(data.groupId)
    if (effectivePlanId(current) !== FREE_PLAN_ID) {
      throw new BillingError("ALREADY_SUBSCRIBED", "The group already has a paid plan")
    }
    const customerId = await dependencies.billing.customerOf(data.groupId)
    const result = await provider.createCheckout({
      planId: data.planId,
      successUrl: appUrl(dependencies, `/groups/${data.groupId}`),
      cancelUrl: appUrl(dependencies, `/groups/${data.groupId}/pricing`),
      reference: data.groupId,
      ...(customerId ? { customerId } : {}),
      ...(data.idempotencyKey ? { idempotencyKey: data.idempotencyKey } : {}),
    })
    if (!result.ok) {
      dependencies.log("error: billing checkout failed", result.error)
      throw new BillingError("PROVIDER_ERROR", "The payment provider did not answer")
    }
    return { url: result.value.url }
  }
}

export function createBillingPortalHandler(
  dependencies: BillingHandlerDependencies,
): CommandHandler<BillingPortalCommand> {
  return async ({ data }) => {
    const provider = await authorize(dependencies, data.groupId, data.actor.userId)
    const customerId = await dependencies.billing.customerOf(data.groupId)
    if (!customerId) throw new BillingError("NO_SUBSCRIPTION", "The group has never paid")
    const result = await provider.createPortalSession({
      customerId,
      returnUrl: appUrl(dependencies, `/groups/${data.groupId}`),
    })
    if (!result.ok) {
      dependencies.log("error: billing portal failed", result.error)
      throw new BillingError("PROVIDER_ERROR", "The payment provider did not answer")
    }
    return { url: result.value.url }
  }
}

/** Only the owner passes, and only while billing is on. Returns the provider. */
async function authorize(
  { groups, provider }: BillingHandlerDependencies,
  groupId: string,
  userId: number,
): Promise<BillingProvider> {
  assertCanManageBilling(await groups.roleOf(groupId, userId))
  if (!provider) throw new BillingError("BILLING_DISABLED", "Billing is off")
  return provider
}

function appUrl({ webAppUrl }: BillingHandlerDependencies, path: string): string {
  return new URL(path, webAppUrl).href
}
