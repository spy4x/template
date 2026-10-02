import { useEffect } from "preact/hooks"
import { useLocation } from "wouter-preact"
import { BillingCard, PricingScreen } from "@ui/billing-screen.tsx"
import { billingStore } from "../state/billing.ts"
import { groupsStore } from "../state/groups.ts"

/**
 * Reads the group's billing when the page opens and again whenever the group's change sequence
 * moves: a plan change is recorded on the group, so the provider's webhook reaches this page as an
 * ordinary group hint.
 */
function useGroupBilling(groupId: string) {
  const group = groupsStore.groups.value.find((candidate) => candidate.id === groupId) ?? null
  const sequence = group?.changeSequence
  useEffect(() => {
    void billingStore.load(groupId)
  }, [groupId, sequence])
  const current = billingStore.current.value
  const failure = billingStore.error.value
  return {
    group,
    billing: current?.groupId === groupId ? current.billing : null,
    error: failure?.groupId === groupId ? failure.message : null,
    errorId: failure?.groupId === groupId ? failure.id : undefined,
  }
}

/** The plan section of a group's settings page. */
export function GroupBillingCard({ groupId }: { groupId: string }) {
  const [, navigate] = useLocation()
  const { billing, error, errorId } = useGroupBilling(groupId)
  return (
    <BillingCard
      groupId={groupId}
      billing={billing}
      error={error}
      errorId={errorId}
      pending={billingStore.pending.value}
      navigate={navigate}
      onManage={() => void billingStore.portal(groupId)}
    />
  )
}

/** The plans a group can move to, at `/groups/:groupId/pricing`. */
export function PricingView({ groupId }: { groupId: string }) {
  const [, navigate] = useLocation()
  const { group, billing, error, errorId } = useGroupBilling(groupId)
  return (
    <PricingScreen
      groupId={groupId}
      groupName={group?.name ?? null}
      billing={billing}
      error={error}
      errorId={errorId}
      pending={billingStore.pending.value}
      navigate={navigate}
      onChoose={(planId) => void billingStore.checkout(groupId, planId)}
    />
  )
}
