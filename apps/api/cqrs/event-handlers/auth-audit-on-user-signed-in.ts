import { UserSignedInEvent } from "@api/cqrs/events.ts"
import { db } from "@api/services/db.ts"
import { AuthAuditEventType } from "@domain/identity"
export const authAuditOnUserSignedInHandler = async (event: UserSignedInEvent) => {
  const { user, request } = event.data
  await db.authAudit.createOne({
    data: {
      userId: user.id,
      eventType: AuthAuditEventType.SIGNED_IN,
      identifier: null,
      ip: request.ip || null,
      userAgent: request.userAgent || null,
    },
  })
}
