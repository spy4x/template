import { configure } from "arktype/config"
configure({ onUndeclaredKey: "reject", onDeepUndeclaredKey: "reject" })
import { Type, type } from "arktype"

export { type }
export type ValidationSchema = Type

export function validate<T extends Type>(
  schema: T,
  value: unknown,
): { error: null; data: T["infer"] } | {
  error: {
    description: string
    details: type.errors
  }
  data: null
} {
  const result = schema(value)
  if (result instanceof type.errors) {
    return {
      error: {
        description: result.summary,
        details: result,
      },
      data: null,
    }
  }
  return {
    error: null,
    data: result as T["infer"],
  }
}

export const dateSchema = type("Date | string.date.iso.parse")
export type DateType = typeof dateSchema.infer
export const DateNullableSchema = dateSchema.or("null").default(null)

export const ImmutableBaseModelSchema = type({
  id: "number",
  createdAt: dateSchema,
})
export const UndeletableBaseModelSchema = ImmutableBaseModelSchema.and({
  updatedAt: dateSchema,
})
export const BaseModelSchema = UndeletableBaseModelSchema.and({
  deletedAt: DateNullableSchema,
})
export type BaseModel = typeof BaseModelSchema.infer

export const NAME_MAX_LENGTH = 50

export const pushSubscriptionKeysSchema = type({
  auth: "string <= 256",
  p256dh: "string <= 256",
})
export type PushSubscriptionKeys = typeof pushSubscriptionKeysSchema.infer

export const pushSubscriptionSchema = type({
  endpoint: "string <= 256",
  expirationTime: "number | null = null",
  keys: pushSubscriptionKeysSchema,
})
export type PushSubscriptionJson = typeof pushSubscriptionSchema.infer

export const pushSubscribeRequestSchema = type({
  deviceId: "string <= 256",
  subscription: pushSubscriptionSchema,
})
export type PushSubscribeRequest = typeof pushSubscribeRequestSchema.infer

export const pushUnsubscribeRequestSchema = type({
  deviceId: "string <= 256",
})
export type PushUnsubscribeRequest = typeof pushUnsubscribeRequestSchema.infer

export const pushNotificationMessageSchema = type({
  title: "1 <= string <= 120",
  body: "string <= 500 | null = null",
  url: "string <= 2048 | null = null",
})
export type PushNotificationMessage = typeof pushNotificationMessageSchema.infer

export type RequestInfo = {
  requestId?: string
  ip?: string
  userAgent?: string
}

export type ApiError = {
  status: number
  message: string
}

export type ApiResult<T> =
  | { ok: true; status: number; data: T }
  | { ok: false; status: number; error: ApiError }

export type ApiErrorResponse = {
  error: string
}

export type ApiSuccessResponse = {
  success: boolean
}

export type ApiIsSuccessResponse = {
  isSuccess: boolean
}

export type PushSubscriptionData = PushSubscriptionJson

export type PushPublicKeyResponse = {
  publicKey: string
}
