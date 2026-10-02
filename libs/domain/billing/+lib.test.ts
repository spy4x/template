import { expect } from "@std/expect"
import { describe, it } from "@std/testing/bdd"
import { SubscriptionStatus } from "@spy4x/billing"
import { GroupRole } from "@domain/groups"
import {
  assertCanManageBilling,
  assertFeature,
  assertRoomFor,
  BillingError,
  BillingStatus,
  DEFAULT_GRACE_DAYS,
  effectivePlanId,
  entitlementsOf,
  FREE_PLAN_ID,
  graceEndsAt,
  hasLiveSubscription,
  PlanError,
  PLANS,
  PRO_PLAN_ID,
  providerPageUrl,
  readPlanRefusal,
  type StoredSubscription,
  toGroupBilling,
  toPlanRefusal,
  UNLIMITED,
} from "./+lib.ts"

/** When the first payment failed in the tests below. */
const FAILED_AT = new Date("2026-10-01T10:00:00Z")
const NOW = new Date("2026-10-02T10:00:00Z")
const DAY = 24 * 60 * 60 * 1000

const subscription = (status: BillingStatus, planId: string | null = PRO_PLAN_ID) =>
  ({
    groupId: "7b6d8d6c-1af5-4f04-8ae4-b1ee5d111002",
    providerSubscriptionId: "sub_1",
    planId,
    status,
    currentPeriodEnd: null,
    cancelAtPeriodEnd: false,
    pastDueSince: status === BillingStatus.PastDue ? FAILED_AT : null,
  }) satisfies StoredSubscription

/** The plan of a subscription past due since {@link FAILED_AT}, `elapsed` ms later. */
const planAfter = (elapsed: number, graceDays = DEFAULT_GRACE_DAYS) =>
  effectivePlanId(
    subscription(BillingStatus.PastDue),
    new Date(FAILED_AT.getTime() + elapsed),
    graceDays,
  )

describe("billing domain", () => {
  it("numbers its statuses exactly as @spy4x/billing does", () => {
    const ours = Object.entries(BillingStatus).filter(([, value]) => typeof value === "number")
    const theirs = Object.entries(SubscriptionStatus).filter(([, value]) =>
      typeof value === "number"
    )
    expect(ours).toEqual(theirs)
  })

  it("keeps the paid plan while the subscription is trialing or active, however long", () => {
    const years = new Date(FAILED_AT.getTime() + 3 * 365 * DAY)
    for (const status of [BillingStatus.Trialing, BillingStatus.Active]) {
      expect(effectivePlanId(subscription(status), years, DEFAULT_GRACE_DAYS)).toBe(PRO_PLAN_ID)
    }
  })

  it("keeps the paid plan for seven days after the first failed payment, then gives the free plan", () => {
    expect(DEFAULT_GRACE_DAYS).toBe(7)
    expect(planAfter(0)).toBe(PRO_PLAN_ID)
    expect(planAfter(7 * DAY - 1)).toBe(PRO_PLAN_ID)
    expect(planAfter(7 * DAY)).toBe(FREE_PLAN_ID)
    expect(planAfter(30 * DAY)).toBe(FREE_PLAN_ID)
  })

  it("counts the grace period in the configured number of days", () => {
    expect(planAfter(3 * DAY - 1, 3)).toBe(PRO_PLAN_ID)
    expect(planAfter(3 * DAY, 3)).toBe(FREE_PLAN_ID)
    expect(planAfter(0, 0)).toBe(FREE_PLAN_ID)
  })

  it("gives no grace to a past-due subscription with no recorded start", () => {
    const unmarked = { ...subscription(BillingStatus.PastDue), pastDueSince: null }

    expect(effectivePlanId(unmarked, FAILED_AT, DEFAULT_GRACE_DAYS)).toBe(FREE_PLAN_ID)
  })

  it("ends the grace period the configured number of days after it began, only when past due", () => {
    expect(graceEndsAt(subscription(BillingStatus.PastDue), 7))
      .toEqual(new Date("2026-10-08T10:00:00Z"))
    expect(graceEndsAt(subscription(BillingStatus.Active), 7)).toBeNull()
  })

  it("falls back to the free plan once the subscription ends, stalls or bills an unknown price", () => {
    for (const status of [BillingStatus.Canceled, BillingStatus.Incomplete, BillingStatus.Paused]) {
      expect(effectivePlanId(subscription(status), NOW, DEFAULT_GRACE_DAYS)).toBe(FREE_PLAN_ID)
    }
    expect(effectivePlanId(subscription(BillingStatus.Active, null), NOW, DEFAULT_GRACE_DAYS))
      .toBe(FREE_PLAN_ID)
    expect(effectivePlanId(subscription(BillingStatus.Active, "retired"), NOW, DEFAULT_GRACE_DAYS))
      .toBe(FREE_PLAN_ID)
    expect(effectivePlanId(null, NOW, DEFAULT_GRACE_DAYS)).toBe(FREE_PLAN_ID)
  })

  it("shows a past-due group's plan as free once its grace period is over", () => {
    const later = new Date(FAILED_AT.getTime() + 8 * DAY)
    const billing = (now: Date) =>
      toGroupBilling(subscription(BillingStatus.PastDue), GroupRole.OWNER, true, true, now, 7)

    expect(billing(NOW)).toMatchObject({ planId: PRO_PLAN_ID, status: BillingStatus.PastDue })
    expect(billing(later)).toMatchObject({ planId: FREE_PLAN_ID, status: BillingStatus.PastDue })
  })

  it("shows the free plan and no way to manage it while billing is off, whatever is stored", () => {
    expect(
      toGroupBilling(subscription(BillingStatus.Active), GroupRole.OWNER, false, true, NOW, 7),
    )
      .toEqual({
        enabled: false,
        planId: FREE_PLAN_ID,
        status: null,
        currentPeriodEnd: null,
        cancelAtPeriodEnd: false,
        canManage: false,
        subscribed: false,
        hasCustomer: false,
      })
  })

  it("counts every subscription that is not cancelled as live, whatever plan it shows", () => {
    for (
      const status of [
        BillingStatus.Trialing,
        BillingStatus.Active,
        BillingStatus.PastDue,
        BillingStatus.Incomplete,
        BillingStatus.Paused,
      ]
    ) {
      expect(hasLiveSubscription(subscription(status))).toBe(true)
    }
    expect(hasLiveSubscription(subscription(BillingStatus.Active, null))).toBe(true)
    expect(hasLiveSubscription(subscription(BillingStatus.Canceled))).toBe(false)
    expect(hasLiveSubscription(null)).toBe(false)
  })

  it("opens only http and https provider pages", () => {
    expect(providerPageUrl("https://checkout.stripe.com/c/pay/cs_1")).toBe(
      "https://checkout.stripe.com/c/pay/cs_1",
    )
    expect(providerPageUrl("http://localhost:8000/fake")).toBe("http://localhost:8000/fake")
    for (const url of ["javascript:alert(1)", "data:text/html,x", "/relative", "", 42, null]) {
      expect(providerPageUrl(url)).toBeNull()
    }
  })

  it("lets only the owner manage billing, and tells a stranger the group does not exist", () => {
    expect(() => assertCanManageBilling(GroupRole.OWNER)).not.toThrow()
    for (const role of [GroupRole.ADMIN, GroupRole.EDITOR, GroupRole.VIEWER]) {
      expect(() => assertCanManageBilling(role)).toThrow(
        new BillingError("ROLE_INSUFFICIENT", "Only the owner can manage the group's billing"),
      )
    }
    expect(() => assertCanManageBilling(null)).toThrow(
      new BillingError("GROUP_NOT_FOUND", "Group not found"),
    )
  })

  it("gives a group its plan's entitlements, the free plan's for an unknown id", () => {
    expect(entitlementsOf(PRO_PLAN_ID, true).features.memberRoles).toBe(true)
    expect(entitlementsOf(FREE_PLAN_ID, true).features.memberRoles).toBe(false)
    expect(entitlementsOf(FREE_PLAN_ID, true).limits.maxNotes).toBe(10)
    expect(entitlementsOf("gone", true)).toEqual(entitlementsOf(FREE_PLAN_ID, true))
  })

  it("allows every feature with no cap while billing is off", () => {
    const unlimited = entitlementsOf(FREE_PLAN_ID, false)
    expect(unlimited).toBe(UNLIMITED)
    expect(Object.values(unlimited.features).every((on) => on === true)).toBe(true)
    expect(Object.values(unlimited.limits).every((max) => max === null)).toBe(true)
    // Every key a plan has is on the list, so a key added to the plans but not here fails.
    expect(Object.keys(unlimited.features)).toEqual(Object.keys(PLANS[0].entitlements.features))
    expect(Object.keys(unlimited.limits).sort())
      .toEqual(Object.keys(PLANS[0].entitlements.limits).sort())
  })

  it("refuses a feature the plan lacks, and tells only the owner they can upgrade", () => {
    const free = entitlementsOf(FREE_PLAN_ID, true)
    expect(() => assertFeature(entitlementsOf(PRO_PLAN_ID, true), "memberRoles", GroupRole.ADMIN))
      .not.toThrow()
    const refusal = (role: GroupRole) => {
      try {
        assertFeature(free, "memberRoles", role)
      } catch (error) {
        return error instanceof PlanError ? toPlanRefusal(error) : null
      }
      return null
    }
    expect(refusal(GroupRole.OWNER)).toEqual({
      code: "PLAN_FEATURE_MISSING",
      entitlement: "memberRoles",
      limit: null,
      canUpgrade: true,
    })
    expect(refusal(GroupRole.ADMIN)?.canUpgrade).toBe(false)
  })

  it("refuses one more once the count reaches the cap, and never caps a null limit", () => {
    expect(() => assertRoomFor("maxNotes", 10, 9, GroupRole.EDITOR)).not.toThrow()
    expect(() => assertRoomFor("maxNotes", null, 1_000_000, GroupRole.EDITOR)).not.toThrow()
    for (const used of [10, 25]) {
      expect(() => assertRoomFor("maxNotes", 10, used, GroupRole.EDITOR)).toThrow(PlanError)
    }
  })

  it("reads a plan refusal back from an error body and nothing else", () => {
    const body = {
      code: "PLAN_LIMIT_REACHED",
      message: "x",
      entitlement: "maxNotes",
      limit: 10,
      canUpgrade: false,
    }
    expect(readPlanRefusal(body)).toEqual({
      code: "PLAN_LIMIT_REACHED",
      entitlement: "maxNotes",
      limit: 10,
      canUpgrade: false,
    })
    expect(readPlanRefusal({ ...body, code: "ROLE_INSUFFICIENT" })).toBeNull()
    expect(readPlanRefusal({ ...body, canUpgrade: "yes" })).toBeNull()
    expect(readPlanRefusal({ ...body, entitlement: "maxSeats" })).toBeNull()
    expect(readPlanRefusal({ ...body, entitlement: "toString" })).toBeNull()
    expect(readPlanRefusal(null)).toBeNull()
  })
})
