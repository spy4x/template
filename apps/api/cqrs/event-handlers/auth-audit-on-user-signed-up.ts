import { UserSignedUpEvent } from "@api/cqrs/events.ts"
import { db } from "@api/services/db.ts"
import { AuthAuditEventType } from "@domain/identity"
export const authAuditOnUserSignedUpHandler = async (event: UserSignedUpEvent) => {
  const { user, email, request } = event.data
  await db.authAudit.createOne({
    data: {
      userId: user.id,
      eventType: AuthAuditEventType.SIGNED_UP,
      identifier: email,
      ip: request.ip || null,
      userAgent: request.userAgent || null,
    },
  })
}
