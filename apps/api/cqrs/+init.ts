import { commandBus } from "@api/services/commandBus.ts"
import { queryBus } from "@api/services/queryBus.ts"
import { subscribe } from "@api/services/eventBus.ts"
import { sql } from "@api/services/db.ts"
import { log } from "@api/services/log.ts"
import { createIdempotencyMiddleware, PostgresIdempotencyStore } from "@spy4x/server/idempotency"
import { UserProfileUpdateCommand } from "@api/cqrs/commands.ts"
import { UserProfileGetQuery } from "@api/cqrs/queries.ts"
import { GroupCreateCommand, GroupGetQuery, GroupListQuery } from "@domain/groups"
import { userProfileUpdateHandler } from "@api/cqrs/command-handlers/user-profile-update.ts"
import { userProfileGetHandler } from "@api/cqrs/query-handlers/user-profile-get.ts"
import { groupCreateHandler } from "@api/cqrs/command-handlers/group-create.ts"
import { groupGetHandler } from "@api/cqrs/query-handlers/group-get.ts"
import { groupListHandler } from "@api/cqrs/query-handlers/group-list.ts"
import {
  NoteCreateCommand,
  NoteDeleteCommand,
  NoteGetQuery,
  NoteListQuery,
  NoteUpdateCommand,
} from "@domain/notes"
import { noteCreateHandler } from "@api/cqrs/command-handlers/note-create.ts"
import { noteUpdateHandler } from "@api/cqrs/command-handlers/note-update.ts"
import { noteDeleteHandler } from "@api/cqrs/command-handlers/note-delete.ts"
import { noteListHandler } from "@api/cqrs/query-handlers/note-list.ts"
import { noteGetHandler } from "@api/cqrs/query-handlers/note-get.ts"
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

// Every listener is best-effort: a failure is logged and counted (`services/eventBus.ts`) and
// nothing retries it, because the in-process bus holds no copy of the event.
//
// - The four audit listeners ought to be durable, since a lost row is a lost audit record. They
//   stay best-effort until an outbox row can carry the event: today a row has no payload, and the
//   audit row needs the address and user agent, which cannot be read back later.
// - The socket-closing listener is best-effort by nature: sockets live in this process and the
//   worker, which runs outbox jobs, cannot close them. Its durable backstop is already in place:
//   every socket is revalidated on a timer (`realtime.startRevalidation`) and before each
//   request, so a failure here delays the close by one interval at most.
subscribe(UserSignedUpEvent, authAuditOnUserSignedUpHandler)
subscribe(UserSignedInEvent, authAuditOnUserSignedInHandler)
subscribe(UserSignedOutEvent, authAuditOnUserSignedOutHandler)
subscribe(UserProfileUpdatedEvent, authAuditOnUserProfileUpdatedHandler)
subscribe(UserSignedOutEvent, realtimeOnUserSignedOutHandler)

// After the session gate (added where the bus is built): a command from a session that may not act
// never reaches the key store. It needs the database, so it is attached here and not there.
commandBus.use(
  createIdempotencyMiddleware({ store: new PostgresIdempotencyStore(sql), onStoreFailure: log }),
)

commandBus.register(UserProfileUpdateCommand, userProfileUpdateHandler)
commandBus.register(GroupCreateCommand, groupCreateHandler)
commandBus.register(NoteCreateCommand, noteCreateHandler)
commandBus.register(NoteUpdateCommand, noteUpdateHandler)
commandBus.register(NoteDeleteCommand, noteDeleteHandler)
queryBus.register(UserProfileGetQuery, userProfileGetHandler)
queryBus.register(GroupListQuery, groupListHandler)
queryBus.register(GroupGetQuery, groupGetHandler)
queryBus.register(NoteListQuery, noteListHandler)
queryBus.register(NoteGetQuery, noteGetHandler)

console.log("✅ CQRS handlers initialized")
