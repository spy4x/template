import { Command } from "@platform/cqrs/types.ts"
import { RequestInfo } from "@platform/types"
import { User } from "@domain/identity"
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
