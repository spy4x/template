import { commandBus } from "@api/services/commandBus.ts"
import { queryBus } from "@api/services/queryBus.ts"
import { eventBus } from "@api/services/eventBus.ts"
import { UserProfileUpdateCommand } from "@api/cqrs/commands.ts"
import { UserProfileGetQuery } from "@api/cqrs/queries.ts"
import { userProfileUpdateHandler } from "@api/cqrs/command-handlers/user-profile-update.ts"
import { userProfileGetHandler } from "@api/cqrs/query-handlers/user-profile-get.ts"
import {
  UserProfileUpdatedEvent,
  UserSignedInEvent,
  UserSignedOutEvent,
  UserSignedUpEvent,
  PushDevicesUpdatedEvent,
} from "@api/cqrs/events.ts"
import { authAuditOnUserSignedUpHandler } from "@api/cqrs/event-handlers/auth-audit-on-user-signed-up.ts"
import { authAuditOnUserSignedInHandler } from "@api/cqrs/event-handlers/auth-audit-on-user-signed-in.ts"
import { authAuditOnUserSignedOutHandler } from "@api/cqrs/event-handlers/auth-audit-on-user-signed-out.ts"
import { authAuditOnUserProfileUpdatedHandler } from "@api/cqrs/event-handlers/auth-audit-on-user-profile-updated.ts"
import { wsOnUserProfileUpdatedHandler } from "@api/cqrs/event-handlers/ws-on-user-profile-updated.ts"
import { wsOnUserSignedOutHandler } from "@api/cqrs/event-handlers/ws-on-user-signed-out.ts"
import { wsOnPushDevicesUpdatedHandler } from "@api/cqrs/event-handlers/ws-on-push-devices-updated.ts"

eventBus.on(UserSignedUpEvent, authAuditOnUserSignedUpHandler)
eventBus.on(UserSignedInEvent, authAuditOnUserSignedInHandler)
eventBus.on(UserSignedOutEvent, authAuditOnUserSignedOutHandler)
eventBus.on(UserProfileUpdatedEvent, authAuditOnUserProfileUpdatedHandler)
eventBus.on(UserProfileUpdatedEvent, wsOnUserProfileUpdatedHandler)
eventBus.on(UserSignedOutEvent, wsOnUserSignedOutHandler)
eventBus.on(PushDevicesUpdatedEvent, wsOnPushDevicesUpdatedHandler)

commandBus.register(UserProfileUpdateCommand, userProfileUpdateHandler)
queryBus.register(UserProfileGetQuery, userProfileGetHandler)

console.log("✅ CQRS handlers initialized")
