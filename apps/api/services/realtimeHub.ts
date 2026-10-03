import { createGroupSocketRequests } from "../features/groups/socket.ts"
import { createProfileSocketRequests } from "../features/profile/socket.ts"
import { createPushSocketRequests } from "../features/push/socket.ts"
import { createNoteSocketRequests } from "../features/notes/socket.ts"
import { signIn } from "./auth.ts"
import { commandBus } from "./commandBus.ts"
import { db } from "./db.ts"
import { groupListCursor } from "./group-list-cursor.ts"
import { log } from "./log.ts"
import { noteListCursor } from "./note-list-cursor.ts"
import { queryBus } from "./queryBus.ts"
import { Realtime } from "./realtime.ts"

/** The API's one realtime socket service; see {@link Realtime}. */
export const realtime = new Realtime({
  entitledSession: (sessionId) => signIn.entitledSession(sessionId),
  memberUserIds: (groupId) => db.group.listMemberUserIds(groupId),
  requests: {
    ...createGroupSocketRequests({
      create: (command) => commandBus.execute(command),
      list: (query) => queryBus.execute(query),
      get: (query) => queryBus.execute(query),
      select: (command) => commandBus.execute(command),
      selected: (query) => queryBus.execute(query),
      rename: (command) => commandBus.execute(command),
      updateDetails: (command) => commandBus.execute(command),
      delete: (command) => commandBus.execute(command),
      restore: (command) => commandBus.execute(command),
      deleted: (query) => queryBus.execute(query),
      members: (query) => queryBus.execute(query),
      setRole: (command) => commandBus.execute(command),
      removeMember: (command) => commandBus.execute(command),
      leave: (command) => commandBus.execute(command),
      cursor: groupListCursor,
    }),
    ...createProfileSocketRequests({
      get: (query) => queryBus.execute(query),
      update: (command) => commandBus.execute(command),
    }),
    ...createPushSocketRequests({
      register: (command) => commandBus.execute(command),
      remove: (command) => commandBus.execute(command),
      list: (query) => queryBus.execute(query),
    }),
    ...createNoteSocketRequests({
      create: (command) => commandBus.execute(command),
      update: (command) => commandBus.execute(command),
      delete: (command) => commandBus.execute(command),
      move: (command) => commandBus.execute(command),
      list: (query) => queryBus.execute(query),
      get: (query) => queryBus.execute(query),
      locate: (query) => queryBus.execute(query),
      cursor: noteListCursor,
    }),
  },
  log,
})
