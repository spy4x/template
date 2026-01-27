import { Query } from "@shared/cqrs/types.ts"
import { User, UserProfile } from "@shared/types"

export interface UserProfileGetPayload {
  userId: number
}

export interface UserProfileGetResult {
  user: User
  profile: UserProfile | null
}

export class UserProfileGetQuery implements Query<UserProfileGetPayload, UserProfileGetResult> {
  __resultType?: UserProfileGetResult
  constructor(public data: UserProfileGetPayload) {}
}
