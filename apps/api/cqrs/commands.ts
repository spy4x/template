import { Command } from "@shared/cqrs/types.ts"
import { RequestInfo, User } from "@shared/types"

export interface UserProfileUpdatePayload {
  userId: number
  firstName: string
  lastName: string
  request: RequestInfo
}

export interface UserProfileUpdateResult {
  user: User
}

export class UserProfileUpdateCommand
  implements Command<UserProfileUpdatePayload, UserProfileUpdateResult> {
  __resultType?: UserProfileUpdateResult
  constructor(public data: UserProfileUpdatePayload) {}
}
