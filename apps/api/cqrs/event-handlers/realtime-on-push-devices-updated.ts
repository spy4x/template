import { PushDevicesUpdatedEvent } from "@api/cqrs/events.ts"
import { realtime } from "@api/services/realtimeHub.ts"

/** Tells the person's other open tabs that their push devices changed, so they read the list. */
export const realtimeOnPushDevicesUpdatedHandler = (event: PushDevicesUpdatedEvent) => {
  realtime.notifyUserChange(event.data.userId)
}
