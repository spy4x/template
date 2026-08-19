import { UserSignedOutEvent } from "@api/cqrs/events.ts"
import { db } from "@api/services/db.ts"
import { AuthAuditEventType } from "@domain/identity"
export const authAuditOnUserSignedOutHandler = async (event: UserSignedOutEvent) => {
  const { userId, request } = event.data
  await db.authAudit.createOne({
    data: {
      userId,
      eventType: AuthAuditEventType.SIGNED_OUT,
      identifier: null,
      ip: request.ip || null,
      userAgent: request.userAgent || null,
    },
  })
}
