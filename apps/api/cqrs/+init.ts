import { commandBus } from "@api/services/commandBus.ts"
import { queryBus } from "@api/services/queryBus.ts"
import { eventBus } from "@api/services/eventBus.ts"
import { sql } from "@api/services/db.ts"
import { log } from "@api/services/log.ts"
import { createIdempotencyMiddleware } from "@server/idempotency/idempotency.ts"
import { PostgresIdempotencyStore } from "@server/idempotency/postgres-idempotency-store.ts"
import { UserProfileUpdateCommand } from "@api/cqrs/commands.ts"
import { UserProfileGetQuery } from "@api/cqrs/queries.ts"
import { GroupCreateCommand, GroupListQuery } from "@domain/groups"
import { userProfileUpdateHandler } from "@api/cqrs/command-handlers/user-profile-update.ts"
import { userProfileGetHandler } from "@api/cqrs/query-handlers/user-profile-get.ts"
import { groupCreateHandler } from "@api/cqrs/command-handlers/group-create.ts"
import { groupListHandler } from "@api/cqrs/query-handlers/group-list.ts"
import {
  UserProfileUpdatedEvent,
  UserSignedInEvent,
  UserSignedOutEvent,
  UserSignedUpEvent,
} from "@api/cqrs/events.ts"
import { authAuditOnUserSignedUpHandler } from "@api/cqrs/event-handlers/auth-audit-on-user-signed-up.ts"
import { authAuditOnUserSignedInHandler } from "@api/cqrs/event-handlers/auth-audit-on-user-signed-in.ts"
import { authAuditOnUserSignedOutHandler } from "@api/cqrs/event-handlers/auth-audit-on-user-signed-out.ts"
import { authAuditOnUserProfileUpdatedHandler } from "@api/cqrs/event-handlers/auth-audit-on-user-profile-updated.ts"
import { realtimeOnUserSignedOutHandler } from "@api/cqrs/event-handlers/realtime-on-user-signed-out.ts"

eventBus.on(UserSignedUpEvent, authAuditOnUserSignedUpHandler)
eventBus.on(UserSignedInEvent, authAuditOnUserSignedInHandler)
eventBus.on(UserSignedOutEvent, authAuditOnUserSignedOutHandler)
eventBus.on(UserProfileUpdatedEvent, authAuditOnUserProfileUpdatedHandler)
eventBus.on(UserSignedOutEvent, realtimeOnUserSignedOutHandler)

// After the session gate (added where the bus is built): a command from a session that may not act
// never reaches the key store. It needs the database, so it is attached here and not there.
commandBus.use(
  createIdempotencyMiddleware({ store: new PostgresIdempotencyStore(sql), onStoreFailure: log }),
)

commandBus.register(UserProfileUpdateCommand, userProfileUpdateHandler)
commandBus.register(GroupCreateCommand, groupCreateHandler)
queryBus.register(UserProfileGetQuery, userProfileGetHandler)
queryBus.register(GroupListQuery, groupListHandler)

console.log("✅ CQRS handlers initialized")
