import { type } from "arktype"
import { EMAIL_INPUT_MAX_LENGTH } from "@domain/identity"

/**
 * The mailing lists a visitor may join. A list is a plain string: every subscriber row, send log
 * row and token secret is scoped to one. Add a list here and it is open to subscribe to.
 */
export const SUBSCRIBER_LISTS = [`news`] as const
export type SubscriberList = typeof SUBSCRIBER_LISTS[number]

/** The list a subscribe form joins when it names none. */
export const DEFAULT_SUBSCRIBER_LIST: SubscriberList = `news`

/** Whether `value` names one of {@link SUBSCRIBER_LISTS}. */
export function isSubscriberList(value: unknown): value is SubscriberList {
  return SUBSCRIBER_LISTS.includes(value as SubscriberList)
}

/** Longest token a link or form may carry. A real one is a few hundred characters. */
export const SUBSCRIBER_TOKEN_MAX_LENGTH = 2048

/** The body of a subscribe request: the address to confirm and the list to join. */
export const subscribeSchema = type({
  email: `string <= ${EMAIL_INPUT_MAX_LENGTH}`,
  list: `string <= 64`,
})
export type Subscribe = typeof subscribeSchema.infer

/** The body of a confirm: the list and the token from the confirm link. */
export const subscriptionConfirmSchema = type({
  list: `string <= 64`,
  token: `string <= ${SUBSCRIBER_TOKEN_MAX_LENGTH}`,
})
export type SubscriptionConfirm = typeof subscriptionConfirmSchema.infer

/** The fields of the unsubscribe form: the same list and token, from the unsubscribe link. */
export const unsubscribeSchema = subscriptionConfirmSchema
export type Unsubscribe = SubscriptionConfirm

/**
 * What a confirm link page shows. `confirm` asks for the click; `done` follows it. `expired` and
 * `invalid` say why the link no longer works; `error` is a failure on our side.
 */
export type SubscriptionConfirmState = `confirm` | `done` | `expired` | `invalid` | `error`

/** What an unsubscribe link page shows, the same way. */
export type UnsubscribeState = `confirm` | `done` | `not-recognised` | `error`
