import { createGroupSocketRequests } from "../features/groups/socket.ts"
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
      cursor: groupListCursor,
    }),
    ...createNoteSocketRequests({
      create: (command) => commandBus.execute(command),
      update: (command) => commandBus.execute(command),
      delete: (command) => commandBus.execute(command),
      list: (query) => queryBus.execute(query),
      get: (query) => queryBus.execute(query),
      cursor: noteListCursor,
    }),
  },
  log,
})
