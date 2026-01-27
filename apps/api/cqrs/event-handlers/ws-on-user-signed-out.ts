import { UserSignedOutEvent } from "@api/cqrs/events.ts"
import { wsHub } from "@api/services/wsHub.ts"
import { validate, wsAuthSignedOutEventSchema } from "@shared/types"

export const wsOnUserSignedOutHandler = async (event: UserSignedOutEvent) => {
  const { userId } = event.data
  const payload = { kind: "auth.signed_out", payload: { userId } }
  const validationResult = validate(wsAuthSignedOutEventSchema, payload)
  if (!validationResult.error) {
    wsHub.broadcastToUser(userId, validationResult.data)
  }
}
