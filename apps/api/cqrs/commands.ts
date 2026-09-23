import { Command } from "@spy4x/platform/cqrs"
import { RequestInfo } from "@spy4x/platform/request-info"
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
