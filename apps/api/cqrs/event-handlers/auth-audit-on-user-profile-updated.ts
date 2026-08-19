import { UserProfileUpdatedEvent } from "@api/cqrs/events.ts"
import { db } from "@api/services/db.ts"
import { AuthAuditEventType } from "@domain/identity"
export const authAuditOnUserProfileUpdatedHandler = async (
  event: UserProfileUpdatedEvent,
) => {
  const { user, request } = event.data
  await db.authAudit.createOne({
    data: {
      userId: user.id,
      eventType: AuthAuditEventType.PROFILE_UPDATED,
      identifier: null,
      ip: request.ip || null,
      userAgent: request.userAgent || null,
    },
  })
}
