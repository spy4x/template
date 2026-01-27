import { PushDevicesUpdatedEvent } from "@api/cqrs/events.ts"
import { wsHub } from "@api/services/wsHub.ts"
import { validate, wsPushDevicesUpdatedEventSchema } from "@shared/types"

export const wsOnPushDevicesUpdatedHandler = async (event: PushDevicesUpdatedEvent) => {
  const { userId, devices } = event.data
  const payload = { kind: "push.devices.updated", payload: { devices } }
  const validationResult = validate(wsPushDevicesUpdatedEventSchema, payload)
  if (!validationResult.error) {
    wsHub.broadcastToUser(userId, validationResult.data)
  }
}
