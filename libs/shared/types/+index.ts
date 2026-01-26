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

export const NAME_MAX_LENGTH = 50
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
