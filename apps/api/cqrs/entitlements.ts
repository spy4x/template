import { effectivePlanId } from "@domain/billing"
import { billingSetup } from "../services/billing.ts"
import { db } from "../services/db.ts"
import { createEntitlementGate } from "./entitlement-gate.ts"
import { ENTITLEMENT_NEEDS } from "./entitlement-needs.ts"

/**
 * The command bus's plan check, on the billing tables and the membership in Postgres (never a
 * cache: it decides what a group may do).
 */
export const entitlementGate = createEntitlementGate(
  {
    billingEnabled: billingSetup.provider !== null,
    planOf: async (groupId) =>
      effectivePlanId(await db.billing.get(groupId), new Date(), billingSetup.graceDays),
    roleOf: async (groupId, userId) => (await db.group.getForMember(groupId, userId))?.role ?? null,
    usage: { maxNotes: (groupId) => db.note.count(groupId) },
  },
  ENTITLEMENT_NEEDS,
)
