import { UserSignedUpEvent } from "@api/cqrs/events.ts"
import { db } from "@api/services/db.ts"
import { AuthAuditEventType } from "@shared/types"

export const authAuditOnUserSignedUpHandler = async (event: UserSignedUpEvent) => {
  const { user, username, request } = event.data
  await db.authAudit.createOne({
    data: {
      userId: user.id,
      eventType: AuthAuditEventType.SIGNED_UP,
      identifier: username,
      ip: request.ip || null,
      userAgent: request.userAgent || null,
    },
  })
}
