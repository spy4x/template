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
  effectivePlanId,
  entitlementsOf,
  FREE_PLAN_ID,
  hasLiveSubscription,
  PlanError,
  PRO_PLAN_ID,
  providerPageUrl,
  readPlanRefusal,
  type StoredSubscription,
  toGroupBilling,
  toPlanRefusal,
  UNLIMITED,
} from "./+lib.ts"

const subscription = (status: BillingStatus, planId: string | null = PRO_PLAN_ID) =>
  ({
    groupId: "7b6d8d6c-1af5-4f04-8ae4-b1ee5d111002",
    providerSubscriptionId: "sub_1",
    planId,
    status,
    currentPeriodEnd: null,
    cancelAtPeriodEnd: false,
  }) satisfies StoredSubscription

describe("billing domain", () => {
  it("numbers its statuses exactly as @spy4x/billing does", () => {
    const ours = Object.entries(BillingStatus).filter(([, value]) => typeof value === "number")
    const theirs = Object.entries(SubscriptionStatus).filter(([, value]) =>
      typeof value === "number"
    )
    expect(ours).toEqual(theirs)
  })

  it("keeps the paid plan while the subscription is trialing, active or past due", () => {
    for (const status of [BillingStatus.Trialing, BillingStatus.Active, BillingStatus.PastDue]) {
      expect(effectivePlanId(subscription(status))).toBe(PRO_PLAN_ID)
    }
  })

  it("falls back to the free plan once the subscription ends, stalls or bills an unknown price", () => {
    for (const status of [BillingStatus.Canceled, BillingStatus.Incomplete, BillingStatus.Paused]) {
      expect(effectivePlanId(subscription(status))).toBe(FREE_PLAN_ID)
    }
    expect(effectivePlanId(subscription(BillingStatus.Active, null))).toBe(FREE_PLAN_ID)
    expect(effectivePlanId(subscription(BillingStatus.Active, "retired"))).toBe(FREE_PLAN_ID)
    expect(effectivePlanId(null)).toBe(FREE_PLAN_ID)
  })

  it("shows the free plan and no way to manage it while billing is off, whatever is stored", () => {
    expect(toGroupBilling(subscription(BillingStatus.Active), GroupRole.OWNER, false, true))
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
    expect(entitlementsOf(FREE_PLAN_ID, false)).toBe(UNLIMITED)
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
