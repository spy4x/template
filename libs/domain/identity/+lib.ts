import { type } from "arktype"
import { BaseModelSchema, dateSchema } from "@spy4x/platform/model"

// Not in @spy4x/platform/model: too template-specific (a user's name length limit) to belong in a
// general-purpose package. Moved here from the deleted libs/platform/types/+index.ts.
export const NAME_MAX_LENGTH = 50

export enum UserRole {
  VIEWER = 1,
  OPERATOR = 2,
  SUPERVISOR = 3,
  ADMIN = 4,
}
export const userRoleValues = Object.values(UserRole) as UserRole[]

export enum UserMFAStatus {
  NOT_CONFIGURED = 1,
  CONFIGURATION_NOT_FINISHED = 2,
  CONFIGURED = 3,
}
export const userMFAStatusValues = Object.values(
  UserMFAStatus,
) as UserMFAStatus[]

export const userBaseSchema = type({
  firstName: `string <= ${NAME_MAX_LENGTH} = ''`,
  lastName: `string <= ${NAME_MAX_LENGTH} = ''`,
  lastLoginAt: dateSchema.default(() => new Date()),
  mfa: type.enumerated(...userMFAStatusValues).default(
    UserMFAStatus.NOT_CONFIGURED,
  ),
  role: type.enumerated(...userRoleValues).default(UserRole.VIEWER),
})
export type UserBase = typeof userBaseSchema.infer

export const userSchema = BaseModelSchema.and(userBaseSchema)
export type User = typeof userSchema.infer

export const userUpdateSchema = userBaseSchema.pick("firstName", "lastName")
export type UserUpdate = typeof userUpdateSchema.infer

export const userProfileBaseSchema = type({
  firstName: `1 <= string <= ${NAME_MAX_LENGTH}`,
  lastName: `1 <= string <= ${NAME_MAX_LENGTH}`,
})
export type UserProfileBase = typeof userProfileBaseSchema.infer

// A plain ASCII-digit regex, not `string.numeric`: arktype's `numeric` keyword accepts only a
// well-formed number string, and a well-formed number has no leading zero, so any code starting
// with `0` (about one TOTP code in ten) was refused with a 400 before verification. See
// spy4x/template#27.
export const authOTPSchema = type({
  otp: "/^[0-9]{6}$/",
})
export type AuthOTP = typeof authOTPSchema.infer

export const authUsernameSchema = type({
  username: "string <= 50",
})
export type AuthUsername = typeof authUsernameSchema.infer

export const authPasswordSchema = type({
  password: "8 <= string <= 50",
})
export type AuthPassword = typeof authPasswordSchema.infer

export const authUsernamePasswordSchema = authUsernameSchema.and(
  authPasswordSchema,
)
export type AuthUsernamePassword = typeof authUsernamePasswordSchema.infer

export const authPasswordChangeSchema = authPasswordSchema.and({
  newPassword: "8 <= string <= 50",
})
export type AuthPasswordChange = typeof authPasswordChangeSchema.infer

export const userPushTokenSchemaBase = type({
  userId: "number = 0",
  deviceId: "string <= 256 = ''",
  endpoint: "string <= 256 = ''",
  auth: "string <= 256 = ''",
  p256dh: "string <= 256 = ''",
})
export type UserPushTokenBase = typeof userPushTokenSchemaBase.infer

export const userPushTokenSchema = BaseModelSchema.and(userPushTokenSchemaBase)
export type UserPushToken = typeof userPushTokenSchema.infer

export const userPushTokenPublicSchema = userPushTokenSchema.omit(
  "endpoint",
  "auth",
  "p256dh",
  "deletedAt",
)
export type UserPushTokenPublic = typeof userPushTokenPublicSchema.infer

export const wsReadyPayloadSchema = type({
  requestId: "string | null = null",
})
export type WsReadyPayload = typeof wsReadyPayloadSchema.infer

export const wsProfileUpdatedPayloadSchema = type({
  user: userSchema,
})
export type WsProfileUpdatedPayload = typeof wsProfileUpdatedPayloadSchema.infer

export const wsPushDevicesUpdatedPayloadSchema = type({
  devices: userPushTokenPublicSchema.array(),
})
export type WsPushDevicesUpdatedPayload = typeof wsPushDevicesUpdatedPayloadSchema.infer

export const wsAuthSignedOutPayloadSchema = type({
  userId: "number",
})
export type WsAuthSignedOutPayload = typeof wsAuthSignedOutPayloadSchema.infer

export const wsReadyEventSchema = type({
  kind: "'ws.ready'",
  payload: wsReadyPayloadSchema,
})
export const wsProfileUpdatedEventSchema = type({
  kind: "'profile.updated'",
  payload: wsProfileUpdatedPayloadSchema,
})
export const wsPushDevicesUpdatedEventSchema = type({
  kind: "'push.devices.updated'",
  payload: wsPushDevicesUpdatedPayloadSchema,
})
export const wsAuthSignedOutEventSchema = type({
  kind: "'auth.signed_out'",
  payload: wsAuthSignedOutPayloadSchema,
})
export const wsProfileEventSchema = wsReadyEventSchema
  .or(wsProfileUpdatedEventSchema)
  .or(wsPushDevicesUpdatedEventSchema)
  .or(wsAuthSignedOutEventSchema)
export type WsProfileEvent = typeof wsProfileEventSchema.infer

export enum AuthAuditEventType {
  SIGNED_UP = 1,
  SIGNED_IN = 2,
  SIGNED_OUT = 3,
  PROFILE_UPDATED = 4,
}

export const authAuditBaseSchema = type({
  userId: "number = 0",
  eventType: type.enumerated(
    AuthAuditEventType.SIGNED_UP,
    AuthAuditEventType.SIGNED_IN,
    AuthAuditEventType.SIGNED_OUT,
    AuthAuditEventType.PROFILE_UPDATED,
  ),
  identifier: "string <= 100 | null = null",
  ip: "string <= 45 | null = null",
  userAgent: "string <= 300 | null = null",
})
export type AuthAuditBase = typeof authAuditBaseSchema.infer

export const authAuditSchema = BaseModelSchema.and(authAuditBaseSchema)
export type AuthAudit = typeof authAuditSchema.infer

export type ProfileResponse = {
  user: User
}

export type PushDevicesResponse = {
  data: UserPushTokenPublic[]
}

export type PushSubscribeResponse = {
  userPushToken: UserPushTokenPublic
}

export type TotpConnectStartResponse = {
  qrcode: string
  secret: string
}

// The four response shapes below have no @spy4x/platform/api counterpart: they name this app's
// own endpoint responses (a boolean success flag, a public key string), not a general envelope.
// Moved here from the deleted libs/platform/types/+index.ts.
export type ApiSuccessResponse = {
  success: boolean
}

export type ApiIsSuccessResponse = {
  isSuccess: boolean
}

export type PushPublicKeyResponse = {
  publicKey: string
}
