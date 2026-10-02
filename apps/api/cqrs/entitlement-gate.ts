import type { Command, CommandConstructor, CqrsMiddleware } from "@spy4x/platform/cqrs"
import {
  assertFeature,
  assertRoomFor,
  type EntitlementNeed,
  entitlementsOf,
  type FeatureKey,
  type LimitKey,
} from "@domain/billing"
import type { GroupRole } from "@domain/groups"

/** A command that counts against a cap: the gate tells its handler the cap it found. */
export interface MeteredCommand {
  allowance?: number | null
}

/** What one command needs from its group's plan, and who the gate judges. */
interface CommandNeed<T> {
  /** The group the command acts on. */
  groupOf(command: T): string
  need: EntitlementNeed
  /**
   * The roles that may run the command at all. Anyone else (a stranger, a viewer asking for an
   * editor's command) passes on to the handler, which refuses them as it always has: a stranger
   * learns nothing about the group's plan, and a viewer is not told to upgrade for a write no plan
   * would let them make.
   */
  allows(role: GroupRole): boolean
}

// deno-lint-ignore no-explicit-any
type AnyCommand = Command<any, any>

/** The commands the gate checks, one entry each. Build entries with {@link needsFeature} and {@link needsRoom}. */
export type EntitlementNeeds = ReadonlyMap<CommandConstructor<AnyCommand>, CommandNeed<AnyCommand>>

/** An entry for a command that needs a feature of the plan. */
export function needsFeature<T extends AnyCommand>(
  commandClass: CommandConstructor<T>,
  feature: FeatureKey,
  groupOf: (command: T) => string,
  allows: (role: GroupRole) => boolean,
): [CommandConstructor<AnyCommand>, CommandNeed<AnyCommand>] {
  return [commandClass, { groupOf, need: { feature }, allows } as CommandNeed<AnyCommand>]
}

/** An entry for a command that adds one to a capped count. Its handler reads `allowance`. */
export function needsRoom<T extends AnyCommand & MeteredCommand>(
  commandClass: CommandConstructor<T>,
  limit: LimitKey,
  groupOf: (command: T) => string,
  allows: (role: GroupRole) => boolean,
): [CommandConstructor<AnyCommand>, CommandNeed<AnyCommand>] {
  return [commandClass, { groupOf, need: { limit }, allows } as CommandNeed<AnyCommand>]
}

export interface EntitlementGateDependencies {
  /** `false` when the deployment takes no payments: every group may do everything. */
  billingEnabled: boolean
  /** The plan the group is on now (`effectivePlanId`). */
  planOf(groupId: string): Promise<string>
  /** The actor's role in the group, or `null` for a stranger. */
  roleOf(groupId: string, userId: number): Promise<GroupRole | null>
  /** How much of each capped count the group uses now. A cap a command names must be here. */
  usage: Partial<Record<LimitKey, (groupId: string) => Promise<number>>>
}

function actorIdOf(command: AnyCommand): number | null {
  const actor = (command.data as { actor?: { userId?: unknown } } | null)?.actor
  return typeof actor?.userId === "number" ? actor.userId : null
}

/**
 * The one place a plan refuses a command. Each command that needs something from its group's plan
 * is listed in `needs`; the gate reads the group's plan and refuses the command with a `PlanError`
 * before its handler runs. Every other command, and every query, passes untouched, so a group
 * over its caps after a downgrade still reads all it has.
 *
 * A capped command also gets the cap as `allowance`: the gate's count runs outside the write's
 * transaction, so two requests can both pass it for the last free slot, and the write counts
 * again under the group's lock and refuses the second one.
 */
export function createEntitlementGate(
  dependencies: EntitlementGateDependencies,
  needs: EntitlementNeeds,
): CqrsMiddleware {
  for (const { need } of needs.values()) {
    if ("limit" in need && !dependencies.usage[need.limit]) {
      throw new Error(`The entitlement gate has no usage count for "${need.limit}"`)
    }
  }
  return async (message, next) => {
    const entry = needs.get(message.constructor as CommandConstructor<AnyCommand>)
    if (!entry) return await next()
    const command = message as AnyCommand & MeteredCommand
    if (!dependencies.billingEnabled) {
      if ("limit" in entry.need) command.allowance = null
      return await next()
    }
    const groupId = entry.groupOf(command)
    const actorId = actorIdOf(command)
    const role = actorId === null ? null : await dependencies.roleOf(groupId, actorId)
    const entitlements = entitlementsOf(await dependencies.planOf(groupId), true)
    if ("limit" in entry.need) {
      const max = entitlements.limits[entry.need.limit]
      command.allowance = max
      if (role === null || !entry.allows(role) || max === null) return await next()
      const count = dependencies.usage[entry.need.limit] as (groupId: string) => Promise<number>
      assertRoomFor(entry.need.limit, max, await count(groupId), role)
      return await next()
    }
    if (role !== null && entry.allows(role)) {
      assertFeature(entitlements, entry.need.feature, role)
    }
    return await next()
  }
}
