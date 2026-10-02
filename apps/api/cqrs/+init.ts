import { commandBus } from "@api/services/commandBus.ts"
import { queryBus } from "@api/services/queryBus.ts"
import { subscribe } from "@api/services/eventBus.ts"
import { sql } from "@api/services/db.ts"
import { log } from "@api/services/log.ts"
import { createIdempotencyMiddleware, PostgresIdempotencyStore } from "@spy4x/server/idempotency"
import {
  PushRegisterCommand,
  PushRemoveCommand,
  UserProfileUpdateCommand,
} from "@api/cqrs/commands.ts"
import { PushListQuery, UserProfileGetQuery } from "@api/cqrs/queries.ts"
import {
  GroupCreateCommand,
  GroupDeleteCommand,
  GroupDeletedListQuery,
  GroupGetQuery,
  GroupLeaveCommand,
  GroupListQuery,
  GroupMemberRemoveCommand,
  GroupMemberRoleCommand,
  GroupMembersQuery,
  GroupRenameCommand,
  GroupRestoreCommand,
  GroupSelectCommand,
  GroupSelectedQuery,
} from "@domain/groups"
import { userProfileUpdateHandler } from "@api/cqrs/command-handlers/user-profile-update.ts"
import { userProfileGetHandler } from "@api/cqrs/query-handlers/user-profile-get.ts"
import { pushRegisterHandler } from "@api/cqrs/command-handlers/push-register.ts"
import { pushRemoveHandler } from "@api/cqrs/command-handlers/push-remove.ts"
import { pushListHandler } from "@api/cqrs/query-handlers/push-list.ts"
import { groupCreateHandler } from "@api/cqrs/command-handlers/group-create.ts"
import { groupGetHandler } from "@api/cqrs/query-handlers/group-get.ts"
import { groupListHandler } from "@api/cqrs/query-handlers/group-list.ts"
import { groupSelectHandler } from "@api/cqrs/command-handlers/group-select.ts"
import { groupRenameHandler } from "@api/cqrs/command-handlers/group-rename.ts"
import { groupDeleteHandler } from "@api/cqrs/command-handlers/group-delete.ts"
import { groupRestoreHandler } from "@api/cqrs/command-handlers/group-restore.ts"
import { groupDeletedListHandler } from "@api/cqrs/query-handlers/group-deleted-list.ts"
import { groupSelectedHandler } from "@api/cqrs/query-handlers/group-selected.ts"
import { groupMembersHandler } from "@api/cqrs/query-handlers/group-members.ts"
import { groupMemberRoleHandler } from "@api/cqrs/command-handlers/group-member-role.ts"
import { groupMemberRemoveHandler } from "@api/cqrs/command-handlers/group-member-remove.ts"
import { groupLeaveHandler } from "@api/cqrs/command-handlers/group-leave.ts"
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
  GroupSelectedEvent,
  PushDevicesUpdatedEvent,
  UserProfileUpdatedEvent,
  UserSignedOutEvent,
} from "@api/cqrs/events.ts"
import { realtimeOnUserProfileUpdatedHandler } from "@api/cqrs/event-handlers/realtime-on-user-profile-updated.ts"
import { realtimeOnGroupSelectedHandler } from "@api/cqrs/event-handlers/realtime-on-group-selected.ts"
import { realtimeOnPushDevicesUpdatedHandler } from "@api/cqrs/event-handlers/realtime-on-push-devices-updated.ts"
import { realtimeOnUserSignedOutHandler } from "@api/cqrs/event-handlers/realtime-on-user-signed-out.ts"

// Audit rows have no listener: sign-up, sign-in, sign-out and the profile change write their
// `auth_audits` row in the transaction of the change itself, so the change and its row are kept
// or undone together (#191).
//
// Every listener is best-effort: a failure is logged and counted (`services/eventBus.ts`) and
// nothing retries it, because the in-process bus holds no copy of the event.
//
// - The socket-closing listener is best-effort by nature: sockets live in this process and the
//   worker, which runs outbox jobs, cannot close them. Its durable backstop is already in place:
//   every socket is revalidated on a timer (`realtime.startRevalidation`) and before each
//   request, so a failure here delays the close by one interval at most.
// - The two hint listeners are best-effort for the same reason. A hint a tab misses is caught up
//   by the read the page makes whenever its socket opens again.
subscribe(UserSignedOutEvent, realtimeOnUserSignedOutHandler)
subscribe(UserProfileUpdatedEvent, realtimeOnUserProfileUpdatedHandler)
subscribe(PushDevicesUpdatedEvent, realtimeOnPushDevicesUpdatedHandler)
subscribe(GroupSelectedEvent, realtimeOnGroupSelectedHandler)

// After the session gate (added where the bus is built): a command from a session that may not act
// never reaches the key store. It needs the database, so it is attached here and not there.
commandBus.use(
  createIdempotencyMiddleware({ store: new PostgresIdempotencyStore(sql), onStoreFailure: log }),
)

commandBus.register(UserProfileUpdateCommand, userProfileUpdateHandler)
commandBus.register(PushRegisterCommand, pushRegisterHandler)
commandBus.register(PushRemoveCommand, pushRemoveHandler)
commandBus.register(GroupCreateCommand, groupCreateHandler)
commandBus.register(GroupSelectCommand, groupSelectHandler)
commandBus.register(GroupRenameCommand, groupRenameHandler)
commandBus.register(GroupDeleteCommand, groupDeleteHandler)
commandBus.register(GroupRestoreCommand, groupRestoreHandler)
commandBus.register(GroupMemberRoleCommand, groupMemberRoleHandler)
commandBus.register(GroupMemberRemoveCommand, groupMemberRemoveHandler)
commandBus.register(GroupLeaveCommand, groupLeaveHandler)
commandBus.register(NoteCreateCommand, noteCreateHandler)
commandBus.register(NoteUpdateCommand, noteUpdateHandler)
commandBus.register(NoteDeleteCommand, noteDeleteHandler)
queryBus.register(UserProfileGetQuery, userProfileGetHandler)
queryBus.register(PushListQuery, pushListHandler)
queryBus.register(GroupListQuery, groupListHandler)
queryBus.register(GroupGetQuery, groupGetHandler)
queryBus.register(GroupSelectedQuery, groupSelectedHandler)
queryBus.register(GroupDeletedListQuery, groupDeletedListHandler)
queryBus.register(GroupMembersQuery, groupMembersHandler)
queryBus.register(NoteListQuery, noteListHandler)
queryBus.register(NoteGetQuery, noteGetHandler)

console.log("✅ CQRS handlers initialized")
