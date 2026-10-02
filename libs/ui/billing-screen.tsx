import type { JSX } from "preact"
import { useEffect, useRef } from "preact/hooks"
import { BillingInterval, PlanCard, PricingTable, UpgradePrompt } from "@spy4x/preact-ui/billing"
import { Button } from "@spy4x/preact-ui/button"
import { Card, CardBody } from "@spy4x/preact-ui/card"
import { EmptyState } from "@spy4x/preact-ui/empty-state"
import { ErrorState } from "@spy4x/preact-ui/error-state"
import { Link } from "@spy4x/preact-ui/link"
import { Stack } from "@spy4x/preact-ui/layout"
import { findPlan, FREE_PLAN_ID, type GroupBilling, PAID_PLANS } from "@domain/billing"
import { GROUP_PATHS, type Navigate } from "./progressive.tsx"

/**
 * The routes a group's billing lives at and posts to. Both posts are made by the server-rendered
 * app for a browser without JavaScript; it asks the API for the provider's page and redirects there.
 */
export const BILLING_PATHS = {
  /** The plans the group can move to. */
  pricing: (groupId: string) => `/groups/${encodeURIComponent(groupId)}/pricing`,
  /** `POST` opens the provider's checkout for `{ planId }`. */
  checkout: (groupId: string) => `/groups/${encodeURIComponent(groupId)}/billing/checkout`,
  /** `POST` opens the provider's portal. Takes no fields. */
  portal: (groupId: string) => `/groups/${encodeURIComponent(groupId)}/billing/portal`,
} as const

/** Every plan as the pricing table draws it: monthly, in the plan's currency. */
const PRICING_PLANS = PAID_PLANS.map((plan) => ({
  id: plan.id,
  name: plan.name,
  amount: plan.amount,
  currency: plan.currency,
  interval: BillingInterval.Month,
  description: plan.description,
  features: plan.features,
}))

function planName(planId: string): string {
  return findPlan(planId)?.name ?? planId
}

export interface BillingCardProps {
  groupId: string
  /** The group's billing, or `null` while it is read. */
  billing: GroupBilling | null
  /** Why the billing could not be read or the portal could not be opened, or `null`. */
  error?: string | null
  /** New on every refusal, so focus moves to the message even when its text repeats. */
  errorId?: number
  /** The portal is being opened. */
  pending?: boolean
  navigate?: Navigate
  /**
   * Opens the provider's portal. Without it, the manage button posts to `BILLING_PATHS.portal`;
   * with it, the app takes the submit over.
   */
  onManage?: () => void
}

/**
 * The plan section of a group's settings. Every member sees the plan; only the owner gets the way
 * to change it: a link to the plans while the group is free, the provider's portal once it pays.
 */
export function BillingCard(
  { groupId, billing, error = null, errorId, pending = false, navigate, onManage }:
    BillingCardProps,
): JSX.Element {
  const message = useRef<HTMLDivElement>(null)
  // A refused portal has no field to fix, so focus lands on the message, under the button pressed.
  useEffect(() => {
    if (error && billing) message.current?.focus()
  }, [error, errorId])
  // PlanCard draws its own form with no submit callback, so the app's callback takes the submit over
  // from the fieldset around it. The listener is added here rather than as `onSubmitCapture`: Preact
  // only maps that prop when the element has an `onsubmit` property, which not every DOM gives a
  // fieldset.
  const portal = useRef<HTMLFieldSetElement>(null)
  useEffect(() => {
    const fieldset = portal.current
    if (!fieldset || !onManage) return
    const take = (event: Event) => {
      event.preventDefault()
      if (!pending) onManage()
    }
    fieldset.addEventListener("submit", take, true)
    return () => fieldset.removeEventListener("submit", take, true)
  }, [onManage, pending, billing])

  // The owner reaches the portal whenever the provider has something of the group's: a live
  // subscription, whatever plan it shows, or a customer with past invoices.
  const portalOpen = billing !== null && billing.canManage &&
    (billing.subscribed || billing.hasCustomer)
  const plan = billing ? findPlan(billing.planId) : null
  const planCard = portalOpen && billing.subscribed && billing.planId !== FREE_PLAN_ID &&
    billing.status !== null && billing.status <= 5
  return (
    <section aria-labelledby="group-billing" data-e2e="group-section-billing">
      <Card>
        <CardBody>
          <Stack>
            <h2 id="group-billing" class="text-base font-semibold">Plan</h2>
            {billing === null
              ? (error
                ? <ErrorState message={error} />
                : <p class="text-sm">Loading the plan...</p>)
              : (
                <div data-e2e="billing-plan" data-plan={billing.planId}>
                  {planCard
                    ? (
                      // The fieldset disables the manage button while the portal opens.
                      <fieldset ref={portal} disabled={pending} class="m-0 min-w-0 border-0 p-0">
                        <PlanCard
                          planName={planName(billing.planId)}
                          status={billing.status as 1 | 2 | 3 | 4 | 5}
                          price={plan
                            ? {
                              amount: plan.amount,
                              currency: plan.currency,
                              interval: BillingInterval.Month,
                            }
                            : undefined}
                          periodEnd={billing.currentPeriodEnd ?? undefined}
                          cancelAtPeriodEnd={billing.cancelAtPeriodEnd}
                          manageAction={BILLING_PATHS.portal(groupId)}
                          headingLevel={3}
                        />
                      </fieldset>
                    )
                    : (
                      <Stack>
                        <p class="text-sm">
                          This group is on the{" "}
                          <strong data-e2e="billing-plan-name">{planName(billing.planId)}</strong>
                          {" "}
                          plan.
                        </p>
                        {!billing.enabled
                          ? null
                          : !billing.canManage
                          ? (
                            <p class="text-sm text-muted" data-e2e="billing-owner-only">
                              Only the group's owner can change its plan.
                            </p>
                          )
                          : (
                            <>
                              {!billing.subscribed && (
                                <UpgradePrompt
                                  href={BILLING_PATHS.pricing(groupId)}
                                  navigate={navigate}
                                  headingLevel={3}
                                  labels={{
                                    title: "Upgrade the group",
                                    message: "A paid plan adds priority support for every member.",
                                    action: "See plans",
                                  }}
                                />
                              )}
                              {portalOpen && (
                                <fieldset
                                  ref={portal}
                                  disabled={pending}
                                  class="m-0 min-w-0 border-0 p-0"
                                >
                                  <form method="post" action={BILLING_PATHS.portal(groupId)}>
                                    <Button type="submit" variant="outline">
                                      Manage billing
                                    </Button>
                                  </form>
                                </fieldset>
                              )}
                            </>
                          )}
                      </Stack>
                    )}
                  <div ref={message} tabIndex={-1} data-e2e="billing-error">
                    <ErrorState message={error} />
                  </div>
                </div>
              )}
          </Stack>
        </CardBody>
      </Card>
    </section>
  )
}

export interface PricingScreenProps {
  groupId: string
  /** The group's name for the heading, or `null` while it is read. */
  groupName: string | null
  /** The group's billing, or `null` while it is read. */
  billing: GroupBilling | null
  /** Why the plans cannot be shown or the checkout could not be opened, or `null`. */
  error?: string | null
  /** New on every refusal, so focus moves to the message even when its text repeats. */
  errorId?: number
  /** A checkout is being opened: every plan's button is disabled. */
  pending?: boolean
  navigate?: Navigate
  /**
   * Opens the provider's checkout for a plan. Without it, each plan's form posts `{ planId }` to
   * `BILLING_PATHS.checkout`; with it, the app takes the submit over.
   */
  onChoose?: (planId: string) => void
}

/**
 * The plans a group can move to. Only the owner gets a plan's "Choose" form; anyone else is told
 * who can choose, and a group that already pays is sent to its settings, where the portal changes
 * the plan.
 */
export function PricingScreen(
  { groupId, groupName, billing, error = null, errorId, pending = false, navigate, onChoose }:
    PricingScreenProps,
): JSX.Element {
  const message = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (error && billing) message.current?.focus()
  }, [error, errorId])

  const back = (
    <Link href={GROUP_PATHS.settings(groupId)} navigate={navigate} class="pc-link text-sm">
      Back to the group
    </Link>
  )
  if (billing === null) {
    return (
      <Stack gap="lg">
        {back}
        {error
          ? <ErrorState message={error} />
          : <EmptyState headingLevel={1} title="Loading the plans..." />}
      </Stack>
    )
  }
  return (
    <Stack gap="lg">
      {back}
      <h1 class="text-xl font-semibold" data-e2e="pricing-title">
        {groupName ? `Plans for ${groupName}` : "Plans"}
      </h1>
      {!billing.enabled
        ? <p class="text-sm" data-e2e="pricing-off">Every group is on the Free plan.</p>
        : !billing.canManage
        ? (
          <p class="text-sm" data-e2e="pricing-owner-only">
            Only the group's owner can change its plan.
          </p>
        )
        : billing.subscribed
        ? (
          <p class="text-sm" data-e2e="pricing-paid">
            This group already has a subscription. Change or cancel it from the group's settings.
          </p>
        )
        : (
          <fieldset disabled={pending} class="m-0 min-w-0 border-0 p-0" data-e2e="pricing-plans">
            <PricingTable
              plans={PRICING_PLANS}
              action={BILLING_PATHS.checkout(groupId)}
              onChoose={onChoose && ((plan) => {
                if (!pending) onChoose(plan.id)
              })}
              headingLevel={2}
            />
          </fieldset>
        )}
      <div ref={message} tabIndex={-1} data-e2e="pricing-error">
        <ErrorState message={error} />
      </div>
    </Stack>
  )
}
