import { Command } from "@spy4x/platform/cqrs"
import { RequestInfo } from "@spy4x/platform/request-info"
import { type Actor, User } from "@domain/identity"
export interface UserProfileUpdatePayload {
  actor: Actor
  firstName: string
  lastName: string
  request: RequestInfo
  /** Makes a retry of this command safe; see the idempotency middleware on the command bus. */
  idempotencyKey?: string
}

export interface UserProfileUpdateResult {
  user: User
}

export class UserProfileUpdateCommand
  implements Command<UserProfileUpdatePayload, UserProfileUpdateResult> {
  __resultType?: UserProfileUpdateResult
  constructor(public data: UserProfileUpdatePayload) {}
}
