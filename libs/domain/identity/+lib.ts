import {
  BaseModelSchema,
  dateSchema,
  NAME_MAX_LENGTH,
  type,
  UndeletableBaseModelSchema,
} from "@platform/types"

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

export const authOTPSchema = type({
  otp: "string.numeric == 6",
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

export enum UserKeyKind {
  USERNAME_PASSWORD = 1,
  USERNAME_2FA_CONNECTING = 2,
  USERNAME_2FA_COMPLETED = 3,
}
export const userKeyKindValues = Object.values(UserKeyKind) as UserKeyKind[]

export enum SessionMFAStatus {
  NOT_REQUIRED = 1,
  NOT_PASSED_YET = 2,
  COMPLETED = 3,
}

export enum UserSessionStatus {
  ACTIVE = 1,
  EXPIRED = 2,
  SIGNED_OUT = 3,
}

export const userSessionStatusValues = Object.values(UserSessionStatus) as UserSessionStatus[]
export const userKeyBaseSchema = type({
  userId: "number = 0",
  kind: type.enumerated(...userKeyKindValues).default(
    UserKeyKind.USERNAME_PASSWORD,
  ),
  identification: "string <= 50 = ''",
  secret: "string <= 60 | null = null",
})
export type UserKeyBase = typeof userKeyBaseSchema.infer

export const userKeySchema = BaseModelSchema.and(userKeyBaseSchema)
export type UserKey = typeof userKeySchema.infer

export const userKeyPublicSchema = userKeySchema.omit("secret")
export type UserKeyPublic = typeof userKeyPublicSchema.infer

export const userSessionBaseSchema = type({
  token: "string <= 32 = ''",
  userId: "number = 0",
  keyId: "number = 0",
  status: type.enumerated(...userSessionStatusValues).default(
    UserSessionStatus.ACTIVE,
  ),
  mfa: type.enumerated(...Object.values(SessionMFAStatus) as SessionMFAStatus[]).default(
    SessionMFAStatus.NOT_REQUIRED,
  ),
  expiresAt: dateSchema.default(() => new Date()),
})
export type UserSessionBase = typeof userSessionBaseSchema.infer

export const userSessionSchema = UndeletableBaseModelSchema.and(
  userSessionBaseSchema,
)
export type UserSession = typeof userSessionSchema.infer

export const userSessionPublicSchema = userSessionSchema.omit("token", "keyId")
export type UserSessionPublic = typeof userSessionPublicSchema.infer

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

/**
 * Who is acting, in a form no transport owns.
 *
 * REST builds this from the session cookie on each request; WebSocket builds it
 * once at upgrade and reuses it per message. Handlers depend on this rather than
 * on a Hono context, so one authorization implementation covers both.
 */
export interface Actor {
  userId: number
  userMfa: UserMFAStatus
  sessionMfa: SessionMFAStatus
}

export type AccessErrorCode = "AUTH_REQUIRED" | "MFA_REQUIRED"

export class AccessError extends Error {
  constructor(
    public readonly code: AccessErrorCode,
    message: string,
  ) {
    super(message)
    this.name = "AccessError"
  }
}

/**
 * Authentication is the transport's job - it either produces an Actor or
 * refuses the request. Authorization is this: it runs per command inside the
 * handler, so a second transport cannot skip it by not mounting a middleware.
 */
export function assertMfaSatisfied(actor: Actor): void {
  if (
    actor.userMfa === UserMFAStatus.CONFIGURED &&
    actor.sessionMfa !== SessionMFAStatus.COMPLETED
  ) {
    throw new AccessError("MFA_REQUIRED", "Second factor has not been completed for this session")
  }
}
