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
  type GroupRoleLookup,
  hasLiveSubscription,
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
  /** Days a past-due group keeps its plan (`BILLING_GRACE_DAYS`). */
  graceDays: number
  /** The current time; tests pass a fixed one. */
  now: () => Date
}

/**
 * The billing handlers. Any member reads the group's plan; only the owner opens checkout or the
 * portal, and a stranger is told the group does not exist. The role is read from Postgres on every
 * call, never from a cache.
 */
export function createBillingGetHandler(
  { billing, groups, provider, graceDays, now }: BillingHandlerDependencies,
): QueryHandler<BillingGetQuery> {
  return async ({ data }) => {
    const role = await groups.roleOf(data.groupId, data.actor.userId)
    assertCanReadBilling(role)
    const [subscription, customerId] = provider
      ? await Promise.all([billing.get(data.groupId), billing.customerOf(data.groupId)])
      : [null, null]
    return {
      billing: toGroupBilling(
        subscription,
        role,
        provider !== null,
        customerId !== null,
        now(),
        graceDays,
      ),
    }
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
    // plan of the one the group has. Any subscription that is not cancelled counts, even a paused,
    // incomplete or unknown-price one that shows as the free plan.
    const current = await dependencies.billing.get(data.groupId)
    if (hasLiveSubscription(current)) {
      throw new BillingError("ALREADY_SUBSCRIBED", "The group already has a subscription")
    }
    const customerId = await dependencies.billing.customerOf(data.groupId)
    const result = await provider.createCheckout({
      planId: data.planId,
      successUrl: appUrl(dependencies, `/groups/${data.groupId}`),
      cancelUrl: appUrl(dependencies, `/groups/${data.groupId}/pricing`),
      reference: data.groupId,
      ...(customerId ? { customerId } : {}),
      // The client's key is scoped to the group and the person, so one person's key can never
      // replay a checkout the provider made for another group or person.
      ...(data.idempotencyKey
        ? { idempotencyKey: `${data.groupId}:${data.actor.userId}:${data.idempotencyKey}` }
        : {}),
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

/**
 * Only the owner of an active group passes, and only while billing is on. Returns the provider. The
 * role is read the way group writes read it, so an ownership change committed first is seen.
 */
async function authorize(
  { billing, provider }: BillingHandlerDependencies,
  groupId: string,
  userId: number,
): Promise<BillingProvider> {
  assertCanManageBilling(await billing.lockedRoleOf(groupId, userId))
  if (!provider) throw new BillingError("BILLING_DISABLED", "Billing is off")
  return provider
}

function appUrl({ webAppUrl }: BillingHandlerDependencies, path: string): string {
  return new URL(path, webAppUrl).href
}
