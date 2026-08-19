export interface Command<TPayload, TResult> {
  data: TPayload
  readonly __resultType?: TResult
}

export interface Query<TPayload, TResult> {
  data: TPayload
  readonly __resultType?: TResult
}

// deno-lint-ignore no-explicit-any
export type CommandConstructor<T extends Command<unknown, unknown>> = new (...args: any[]) => T

// deno-lint-ignore no-explicit-any
export type QueryConstructor<T extends Query<unknown, unknown>> = new (...args: any[]) => T

export type CommandResult<T extends Command<unknown, unknown>> = T extends Command<unknown, infer R>
  ? R
  : never

export type QueryResult<T extends Query<unknown, unknown>> = T extends Query<unknown, infer R> ? R
  : never

export type CommandHandler<T extends Command<unknown, unknown>> = (
  command: T,
) => Promise<CommandResult<T>>

export type QueryHandler<T extends Query<unknown, unknown>> = (
  query: T,
) => Promise<QueryResult<T>>

export interface Event<TPayload> {
  data?: TPayload
}

// deno-lint-ignore no-explicit-any
export type EventConstructor<T extends Event<unknown>> = new (...args: any[]) => T

/**
 * Cross-cutting concern that runs on every dispatch, regardless of the transport
 * that produced the message.
 *
 * This is where checks belong that are neither transport mechanics nor business
 * rules - session strength, auditing, tracing. Putting them in a transport lets a
 * second transport skip them; putting them in handlers duplicates them once per
 * handler and rots the moment someone forgets one.
 */
export type CqrsMiddleware = (
  message: { data: unknown },
  next: () => Promise<unknown>,
) => Promise<unknown>
