import type { PushDevicesUpdatedEvent, UserProfileUpdatedEvent } from "../events.ts"

/** Tells the person's other open tabs that their profile changed, so they read it again. */
export function createProfileHintListener(notifyUserChange: (userId: number) => unknown) {
  return (event: UserProfileUpdatedEvent) => {
    notifyUserChange(event.data.user.id)
  }
}

/** Tells the person's other open tabs that their push devices changed, so they read the list. */
export function createPushDevicesHintListener(notifyUserChange: (userId: number) => unknown) {
  return (event: PushDevicesUpdatedEvent) => {
    notifyUserChange(event.data.userId)
  }
}
