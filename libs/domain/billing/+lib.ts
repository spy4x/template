import { type } from "arktype"
import type { Command, Query } from "@spy4x/platform/cqrs"
import type { Actor } from "@domain/identity"
import { canManageBilling, canRead, GroupRole } from "@domain/groups"

/**
 * Billing: one subscription per group, paid by the group's owner. A group without a paid
 * subscription is on the free plan. The provider (Stripe, through `@spy4x/billing`) owns the money;
 * this app keeps only what the provider's webhooks report. `docs/billing.md` explains the setup.
 */

/** The plan every group is on until a paid subscription says otherwise. */
export const FREE_PLAN_ID = "free"

/** The paid plan. Its provider price comes from the environment (`STRIPE_PRICE_PRO`). */
export const PRO_PLAN_ID = "pro"

// #region Entitlements
/**
 * A feature a plan may include. A product adds its own keys here, and TypeScript then asks for the
 * key in every plan's `entitlements.features` and in {@link UNLIMITED}.
 */
export type FeatureKey =
  /** Give a member another role after they joined. */
  "memberRoles"

/**
 * A count a plan caps. A product adds its own keys the same way as {@link FeatureKey}.
 *
 * - `maxMembers`: members of the group, the owner included. No command adds a member yet; the
 *   invitations (#131) will count against it.
 * - `maxNotes`: notes in the group that are not deleted.
 * - `storageBytes`: bytes of attachments. Attachments (#157) are not built yet; only the key ships.
 */
export type LimitKey = "maxMembers" | "maxNotes" | "storageBytes"

/** What a plan allows: which features it includes, and how much of each count, `null` for no cap. */
export interface Entitlements {
  features: Readonly<Record<FeatureKey, boolean>>
  limits: Readonly<Record<LimitKey, number | null>>
}

/** What a deployment that takes no payments allows every group: everything, with no cap. */
export const UNLIMITED: Entitlements = {
  features: { memberRoles: true },
  limits: { maxMembers: null, maxNotes: null, storageBytes: null },
}

/** What a command needs from the group's plan: a feature it includes, or room under a cap. */
export type EntitlementNeed = { feature: FeatureKey } | { limit: LimitKey }
// #endregion Entitlements

/** One plan of the catalog, as the pricing page shows it. */
export interface Plan {
  id: string
  name: string
  /** In the currency's smallest unit: `900` is €9.00. */
  amount: number
  currency: string
  description: string
  features: string[]
  /** What the plan allows. The server checks these; `features` above is only the pricing text. */
  entitlements: Entitlements
}

/** Every plan, free first. The paid ones are the ones a checkout may name. */
export const PLANS: readonly Plan[] = [
  {
    id: FREE_PLAN_ID,
    name: "Free",
    amount: 0,
    currency: "EUR",
    description: "For trying things out.",
    features: ["Up to 10 notes", "Up to 3 members"],
    entitlements: {
      features: { memberRoles: false },
      limits: { maxMembers: 3, maxNotes: 10, storageBytes: 50 * 1024 * 1024 },
    },
  },
  {
    id: PRO_PLAN_ID,
    name: "Pro",
    amount: 900,
    currency: "EUR",
    description: "For a group that relies on it.",
    features: ["Unlimited notes", "Up to 50 members", "Change members' roles", "Priority support"],
    entitlements: {
      features: { memberRoles: true },
      limits: { maxMembers: 50, maxNotes: null, storageBytes: 10 * 1024 * 1024 * 1024 },
    },
  },
]

/** The plans a checkout may name: every plan but the free one. */
export const PAID_PLANS: readonly Plan[] = PLANS.filter((plan) => plan.id !== FREE_PLAN_ID)

/** The plan with this id, or `null`. */
export function findPlan(id: string): Plan | null {
  return PLANS.find((plan) => plan.id === id) ?? null
}

/**
 * What a group may do: its plan's entitlements, or {@link UNLIMITED} while billing is off, since
 * nobody could pay to lift a cap. An id no plan has gets the free plan's.
 */
export function entitlementsOf(planId: string, billingEnabled: boolean): Entitlements {
  if (!billingEnabled) return UNLIMITED
  return (findPlan(planId) ?? PLANS[0]).entitlements
}

/** The outbox event kind a plan change is recorded under, on the group's change log. */
export const BILLING_EVENTS = {
  planChanged: "group.plan.changed",
} as const

/**
 * Where a subscription stands. The same numbers as `@spy4x/billing`'s `SubscriptionStatus`, kept
 * here so the domain does not depend on the provider package; a unit test pins them together.
 */
export enum BillingStatus {
  Trialing = 1,
  Active = 2,
  PastDue = 3,
  Canceled = 4,
  Incomplete = 5,
  Paused = 6,
}

/** The statuses that keep a paid plan. A past-due subscription keeps it while the provider retries. */
const PAID_STATUSES: ReadonlySet<BillingStatus> = new Set([
  BillingStatus.Trialing,
  BillingStatus.Active,
  BillingStatus.PastDue,
])

/** A group's subscription as this app stores it. */
export interface StoredSubscription {
  groupId: string
  providerSubscriptionId: string
  /** The app's plan id, or `null` when the provider bills a price no plan maps to. */
  planId: string | null
  status: BillingStatus
  currentPeriodEnd: Date | null
  cancelAtPeriodEnd: boolean
}

/** The plan a group is on: the subscription's plan while it is paid, else the free plan. */
export function effectivePlanId(subscription: StoredSubscription | null): string {
  if (subscription === null || subscription.planId === null) return FREE_PLAN_ID
  if (!PAID_STATUSES.has(subscription.status)) return FREE_PLAN_ID
  return findPlan(subscription.planId) ? subscription.planId : FREE_PLAN_ID
}

/**
 * Whether the group has a subscription the provider may still charge: any stored one that is not
 * cancelled, whatever plan or price it bills. A second checkout while one exists would start a
 * second subscription.
 */
export function hasLiveSubscription(subscription: StoredSubscription | null): boolean {
  return subscription !== null && subscription.status !== BillingStatus.Canceled
}

/**
 * The provider page a checkout or portal answer names, when it is an `http:` or `https:` URL; any
 * other scheme (`javascript:`, `data:`) or a value that is no URL gives `null`, so the app never
 * sends a person there.
 */
export function providerPageUrl(value: unknown): string | null {
  if (typeof value !== "string") return null
  try {
    const url = new URL(value)
    return url.protocol === "https:" || url.protocol === "http:" ? url.href : null
  } catch {
    return null
  }
}

/** A group's billing, as the API returns it to any member. */
export interface GroupBilling {
  /** `false` when this deployment takes no payments: every group is on the free plan. */
  enabled: boolean
  planId: string
  /** The subscription's status, or `null` when the group never had one. */
  status: BillingStatus | null
  currentPeriodEnd: Date | null
  cancelAtPeriodEnd: boolean
  /** Whether the person asking may open checkout or the portal: billing is on and they own it. */
  canManage: boolean
  /** The group has a subscription that is not cancelled, so it cannot check out again. */
  subscribed: boolean
  /** The group has a provider customer, so its portal (invoices, card, plan) can be opened. */
  hasCustomer: boolean
}

/** Builds the {@link GroupBilling} view of one group for one member. */
export function toGroupBilling(
  subscription: StoredSubscription | null,
  role: GroupRole,
  enabled: boolean,
  hasCustomer: boolean,
): GroupBilling {
  return {
    enabled,
    planId: enabled ? effectivePlanId(subscription) : FREE_PLAN_ID,
    status: enabled ? subscription?.status ?? null : null,
    currentPeriodEnd: enabled ? subscription?.currentPeriodEnd ?? null : null,
    cancelAtPeriodEnd: enabled ? subscription?.cancelAtPeriodEnd ?? false : false,
    canManage: enabled && canManageBilling(role),
    subscribed: enabled && hasLiveSubscription(subscription),
    hasCustomer: enabled && hasCustomer,
  }
}

export type BillingErrorCode =
  | "ALREADY_SUBSCRIBED"
  | "BILLING_DISABLED"
  | "GROUP_NOT_FOUND"
  | "INVALID_REQUEST"
  | "NO_SUBSCRIPTION"
  | "PROVIDER_ERROR"
  | "ROLE_INSUFFICIENT"
  | "UNKNOWN_PLAN"

export class BillingError extends Error {
  constructor(
    public readonly code: BillingErrorCode,
    message: string,
  ) {
    super(message)
    this.name = "BillingError"
  }
}

export type PlanErrorCode = "PLAN_FEATURE_MISSING" | "PLAN_LIMIT_REACHED"

/**
 * A command the group's plan does not allow: a feature it lacks, or a cap it has reached. The API
 * answers it with 402 Payment Required, so a client tells it apart from a role refusal (403).
 */
export class PlanError extends Error {
  constructor(
    public readonly code: PlanErrorCode,
    /** The feature or the cap that refused it. */
    public readonly entitlement: FeatureKey | LimitKey,
    /** The cap that was reached, or `null` for a missing feature. */
    public readonly limit: number | null,
    /** The person asking may change the plan (the owner); anyone else is told to ask the owner. */
    public readonly canUpgrade: boolean,
    message: string,
  ) {
    super(message)
    this.name = "PlanError"
  }
}

/** What the API and the socket send with a {@link PlanError}, beside its code. */
export interface PlanRefusal {
  code: PlanErrorCode
  entitlement: FeatureKey | LimitKey
  limit: number | null
  canUpgrade: boolean
}

/** The fields of a {@link PlanError} a client needs to draw the upgrade prompt. */
export function toPlanRefusal(error: PlanError): PlanRefusal {
  return {
    code: error.code,
    entitlement: error.entitlement,
    limit: error.limit,
    canUpgrade: error.canUpgrade,
  }
}

/** Reads a {@link PlanRefusal} back from an error body or socket details; `null` for anything else. */
export function readPlanRefusal(value: unknown): PlanRefusal | null {
  if (typeof value !== "object" || value === null) return null
  const { code, entitlement, limit, canUpgrade } = value as Record<string, unknown>
  if (code !== "PLAN_FEATURE_MISSING" && code !== "PLAN_LIMIT_REACHED") return null
  if (typeof entitlement !== "string" || typeof canUpgrade !== "boolean") return null
  if (limit !== null && typeof limit !== "number") return null
  return { code, entitlement: entitlement as FeatureKey | LimitKey, limit, canUpgrade }
}

/** Throws {@link PlanError} unless `entitlements` include `feature`. */
export function assertFeature(
  entitlements: Entitlements,
  feature: FeatureKey,
  role: GroupRole,
): void {
  if (entitlements.features[feature]) return
  throw new PlanError(
    "PLAN_FEATURE_MISSING",
    feature,
    null,
    canManageBilling(role),
    "The group's plan does not include this",
  )
}

/**
 * Throws {@link PlanError} unless one more fits under the cap: `used` is the count before the write,
 * and `max` is the plan's cap (`null` for none). A group already over its cap, after a downgrade,
 * keeps what it has and is refused anything more.
 */
export function assertRoomFor(
  limit: LimitKey,
  max: number | null,
  used: number,
  role: GroupRole,
): void {
  if (max === null || used < max) return
  throw new PlanError(
    "PLAN_LIMIT_REACHED",
    limit,
    max,
    canManageBilling(role),
    "The group has reached its plan's limit",
  )
}

// #region Authorization
/** Throws unless `role` is a member's; a stranger is told the group does not exist. */
export function assertCanReadBilling(role: GroupRole | null): asserts role is GroupRole {
  if (role === null || !canRead(role)) throw new BillingError("GROUP_NOT_FOUND", "Group not found")
}

/** Throws unless `role` is the owner's. See {@link assertCanReadBilling}. */
export function assertCanManageBilling(role: GroupRole | null): void {
  assertCanReadBilling(role)
  if (!canManageBilling(role)) {
    throw new BillingError("ROLE_INSUFFICIENT", "Only the owner can manage the group's billing")
  }
}
// #endregion Authorization

// #region Request schemas
/** `POST /api/groups/:groupId/billing/checkout`, and the pricing page's form: the plan chosen. */
export const billingCheckoutRequestSchema = type({ planId: "0 < string <= 64", "+": "reject" })
export type BillingCheckoutRequest = typeof billingCheckoutRequestSchema.infer
// #endregion Request schemas

// #region Commands and queries
export interface BillingCheckoutPayload {
  actor: Actor
  groupId: string
  planId: string
  idempotencyKey?: string
}

/** Where to send the person: the provider's hosted page. */
export interface BillingRedirect {
  url: string
}

export class BillingCheckoutCommand implements Command<BillingCheckoutPayload, BillingRedirect> {
  __resultType?: BillingRedirect
  constructor(public data: BillingCheckoutPayload) {}
}

export interface BillingPortalPayload {
  actor: Actor
  groupId: string
  idempotencyKey?: string
}

export class BillingPortalCommand implements Command<BillingPortalPayload, BillingRedirect> {
  __resultType?: BillingRedirect
  constructor(public data: BillingPortalPayload) {}
}

export interface BillingGetPayload {
  actor: Actor
  groupId: string
}

export class BillingGetQuery implements Query<BillingGetPayload, { billing: GroupBilling }> {
  __resultType?: { billing: GroupBilling }
  constructor(public data: BillingGetPayload) {}
}
// #endregion Commands and queries

// #region Ports
/** What applying one webhook event did. */
export type BillingApplyOutcome =
  /** The event was stored and the group's subscription changed. */
  | "applied"
  /** This event id was stored before: nothing changed. */
  | "duplicate"
  /** Stored, but older than what the group's subscription already says: nothing changed. */
  | "stale"
  /** Stored, but it names no group of this app, or is not about a subscription. */
  | "ignored"

/**
 * Where billing is kept. `applyEvent` stores the provider's event id and applies the event in one
 * transaction, so a second delivery of the same event changes nothing.
 */
export interface BillingRepository {
  get(groupId: string): Promise<StoredSubscription | null>
  /**
   * The actor's role in the group, read the way a group write reads it (`lockActorRole`): a removal
   * or a role change committed first is seen, and `null` answers a stranger or a deleted group.
   */
  lockedRoleOf(groupId: string, userId: number): Promise<GroupRole | null>
  /** The provider customer that pays for the group, or `null` before its first checkout. */
  customerOf(groupId: string): Promise<string | null>
}

/** The actor's role in a group, or `null` when they are not an active member of an active group. */
export interface GroupRoleLookup {
  roleOf(groupId: string, userId: number): Promise<GroupRole | null>
}
// #endregion Ports
