import type { JSX } from "preact"
import { useEffect, useRef } from "preact/hooks"
import { UpgradePrompt } from "@spy4x/preact-ui/billing"
import type { FeatureKey, LimitKey, PlanRefusal } from "@domain/billing"
import { BILLING_PATHS } from "./billing-screen.tsx"
import type { Navigate } from "./progressive.tsx"

/** What a refusal says, per entitlement: a title, and what the plan allows. */
const REFUSAL_TEXT: Record<
  FeatureKey | LimitKey,
  (limit: number | null) => {
    title: string
    message: string
  }
> = {
  maxNotes: (limit) => ({
    title: "This group has reached its note limit",
    message: `Its plan holds up to ${limit} notes. Every note it has stays readable and editable.`,
  }),
  maxMembers: (limit) => ({
    title: "This group has reached its member limit",
    message: `Its plan allows up to ${limit} members.`,
  }),
  storageBytes: () => ({
    title: "This group has used all its storage",
    message: "Its plan has no room for more files.",
  }),
  memberRoles: () => ({
    title: "Changing roles needs a paid plan",
    message: "This group's plan keeps every member in the role they joined with.",
  }),
}

export interface PlanRefusalNoticeProps {
  groupId: string
  /** The refusal the API sent with its 402, or the socket with its `forbidden`. */
  refusal: PlanRefusal
  navigate?: Navigate
  /** The level of the notice's heading. */
  headingLevel?: 2 | 3 | 4
}

/**
 * Why the group's plan refused an action, shown where the action was. The owner gets an upgrade
 * link to the group's pricing page; anyone else is told to ask the owner, as only the owner can
 * change the plan. Focus moves to the notice, so a keyboard or screen reader user hears it.
 */
export function PlanRefusalNotice(
  { groupId, refusal, navigate, headingLevel = 3 }: PlanRefusalNoticeProps,
): JSX.Element {
  const box = useRef<HTMLDivElement>(null)
  useEffect(() => box.current?.focus(), [refusal])
  const text = REFUSAL_TEXT[refusal.entitlement](refusal.limit)
  return (
    <div
      ref={box}
      tabIndex={-1}
      data-e2e="plan-refusal"
      data-entitlement={refusal.entitlement}
    >
      {refusal.canUpgrade
        ? (
          <UpgradePrompt
            href={BILLING_PATHS.pricing(groupId)}
            navigate={navigate}
            headingLevel={headingLevel}
            labels={{ title: text.title, message: text.message, action: "See plans" }}
          />
        )
        : (
          <div class="rounded-md border border-dashed border-control bg-surface p-4 text-sm">
            <p class="font-semibold">{text.title}</p>
            <p class="text-muted" data-e2e="plan-refusal-ask-owner">
              {text.message} Ask the group's owner to upgrade the plan.
            </p>
          </div>
        )}
    </div>
  )
}
