import type { CqrsMiddleware } from "@platform/cqrs/types.ts"
import { AccessError, type Actor, assertMfaSatisfied } from "@domain/identity"

// deno-lint-ignore no-explicit-any
type MessageConstructor = new (...args: any[]) => { data: unknown }

function actorOf(data: unknown): Actor | null {
  if (typeof data !== "object" || data === null || !("actor" in data)) return null
  const actor = (data as { actor: unknown }).actor
  return typeof actor === "object" && actor !== null ? actor as Actor : null
}

/**
 * Guards every dispatch unless the message is explicitly exempted.
 *
 * The default is deny, because the two mistakes are not equal. Forgetting to
 * exempt a genuinely anonymous message fails loudly the first time it runs.
 * Forgetting to guard a user-facing one fails silently, in production, as a
 * missing authorization check.
 *
 * Exemptions are listed at the single place where handlers are registered, so
 * the whole authorization posture can be read in one screen and reviewed as a
 * diff when it changes.
 *
 * Exempted messages are anonymous by construction - sign-in before a session
 * exists, or a worker draining the outbox. A guarded message that arrives
 * without an actor is a wiring bug, not an anonymous request, so it is rejected
 * rather than waved through.
 */
export function createSessionGate(
  anonymous: Iterable<MessageConstructor> = [],
): CqrsMiddleware {
  const exempt = new Set<unknown>(anonymous)
  return (message, next) => {
    if (exempt.has(message.constructor)) {
      return next()
    }
    const actor = actorOf(message.data)
    if (!actor) {
      throw new AccessError(
        "AUTH_REQUIRED",
        `${message.constructor.name} carries no actor and is not registered as anonymous`,
      )
    }
    assertMfaSatisfied(actor)
    return next()
  }
}
