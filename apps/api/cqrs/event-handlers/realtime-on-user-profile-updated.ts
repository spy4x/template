import { UserProfileUpdatedEvent } from "@api/cqrs/events.ts"
import { realtime } from "@api/services/realtimeHub.ts"

/** Tells the person's other open tabs that their profile changed, so they read it again. */
export const realtimeOnUserProfileUpdatedHandler = (event: UserProfileUpdatedEvent) => {
  realtime.notifyUserChange(event.data.user.id)
}
