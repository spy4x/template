import { Query } from "@spy4x/platform/cqrs"
import { type Actor, User } from "@domain/identity"
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
