import { UserProfileUpdatedEvent } from "@api/cqrs/events.ts"
import { wsHub } from "@api/services/wsHub.ts"
import { validate } from "@platform/types"
import { wsProfileUpdatedEventSchema } from "@domain/identity"
export const wsOnUserProfileUpdatedHandler = async (event: UserProfileUpdatedEvent) => {
  const { user } = event.data
  const payload = { kind: "profile.updated", payload: { user } }
  const validationResult = validate(wsProfileUpdatedEventSchema, payload)
  if (!validationResult.error) {
    wsHub.broadcastToUser(user.id, validationResult.data)
  }
}
