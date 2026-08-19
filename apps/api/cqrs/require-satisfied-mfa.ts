import type { CqrsMiddleware } from "@platform/cqrs/types.ts"
import { type Actor, assertMfaSatisfied } from "@domain/identity"

function actorOf(data: unknown): Actor | null {
  if (typeof data !== "object" || data === null || !("actor" in data)) return null
  const actor = (data as { actor: unknown }).actor
  return typeof actor === "object" && actor !== null ? actor as Actor : null
}

/**
 * Rejects any actor-scoped message whose session has not completed the second
 * factor.
 *
 * This runs in the dispatch pipeline rather than in a transport, so REST and
 * WebSocket are covered by one implementation and a new transport cannot skip
 * it by not mounting a middleware. It is deliberately not in the handlers:
 * whether a session is strong enough is an authentication concern, not a
 * business rule, and repeating it per handler only creates one place to forget.
 *
 * Messages without an actor are system-initiated - the worker draining the
 * outbox, for example - and carry no session to judge. They are not silently
 * privileged: without an actor they also have no user identity to scope data
 * by, so a user-facing message that omitted one would fail in its handler.
 */
export const requireSatisfiedMfa: CqrsMiddleware = (message, next) => {
  const actor = actorOf(message.data)
  if (actor) assertMfaSatisfied(actor)
  return next()
}
