import { Event } from "@platform/cqrs/types.ts"
import { RequestInfo } from "@platform/types"
import { User, UserPushTokenPublic } from "@domain/identity"
export class UserSignedUpEvent
  implements Event<{ user: User; username: string; request: RequestInfo }> {
  constructor(public data: { user: User; username: string; request: RequestInfo }) {}
}

export class UserSignedInEvent implements Event<{ user: User; request: RequestInfo }> {
  constructor(public data: { user: User; request: RequestInfo }) {}
}

export class UserSignedOutEvent implements Event<{ userId: number; request: RequestInfo }> {
  constructor(public data: { userId: number; request: RequestInfo }) {}
}

export class UserProfileUpdatedEvent implements Event<{ user: User; request: RequestInfo }> {
  constructor(public data: { user: User; request: RequestInfo }) {}
}

export class PushDevicesUpdatedEvent
  implements Event<{ userId: number; devices: UserPushTokenPublic[]; request: RequestInfo }> {
  constructor(
    public data: { userId: number; devices: UserPushTokenPublic[]; request: RequestInfo },
  ) {}
}
