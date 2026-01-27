import { Command } from "@shared/cqrs/types.ts"
import { RequestInfo, User, UserProfile } from "@shared/types"

export interface UserProfileUpdatePayload {
  userId: number
  displayName: string
  request: RequestInfo
}

export interface UserProfileUpdateResult {
  user: User
  profile: UserProfile
}

export class UserProfileUpdateCommand
  implements Command<UserProfileUpdatePayload, UserProfileUpdateResult> {
  __resultType?: UserProfileUpdateResult
  constructor(public data: UserProfileUpdatePayload) {}
}
