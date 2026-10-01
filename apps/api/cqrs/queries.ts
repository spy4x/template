import { Query } from "@spy4x/platform/cqrs"
import { type Actor, User, type UserPushTokenPublic } from "@domain/identity"
export interface UserProfileGetPayload {
  actor: Actor
}

export interface UserProfileGetResult {
  user: User
}

export class UserProfileGetQuery implements Query<UserProfileGetPayload, UserProfileGetResult> {
  __resultType?: UserProfileGetResult
  constructor(public data: UserProfileGetPayload) {}
}

export interface PushListPayload {
  actor: Actor
}

export interface PushListResult {
  devices: UserPushTokenPublic[]
}

export class PushListQuery implements Query<PushListPayload, PushListResult> {
  __resultType?: PushListResult
  constructor(public data: PushListPayload) {}
}
