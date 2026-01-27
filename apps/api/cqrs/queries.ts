import { Query } from "@shared/cqrs/types.ts"
import { User } from "@shared/types"

export interface UserProfileGetPayload {
  userId: number
}

export interface UserProfileGetResult {
  user: User
}

export class UserProfileGetQuery implements Query<UserProfileGetPayload, UserProfileGetResult> {
  __resultType?: UserProfileGetResult
  constructor(public data: UserProfileGetPayload) {}
}
