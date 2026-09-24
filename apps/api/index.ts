import { Hono } from "hono"
import type { Context } from "hono"
import { contextStorage } from "hono/context-storage"
import { requestId } from "hono/request-id"
import { requestLog } from "@spy4x/server/request-log"
import { db } from "@api/services/db.ts"
import { config } from "@api/services/config.ts"
import { log } from "@api/services/log.ts"
import { parseAuth } from "@api/services/auth.ts"
import { APIContext } from "./_types.ts"
import { randomBase64Url } from "@spy4x/platform/tokens"
import { authRoute } from "./routes/auth.ts"
import { pushNotificationRoute } from "./routes/pushNotification.ts"
import { usersRoute } from "./routes/users.ts"
import { wsRoute } from "./routes/ws.ts"
import { createGroupsRoute } from "./routes/groups.ts"
import { commandBus } from "./services/commandBus.ts"
import { queryBus } from "./services/queryBus.ts"
import { GroupListCursorCodec } from "@server/groups/group-list-cursor.ts"
import "./cqrs/+init.ts"

const app = new Hono<APIContext>().basePath("/api")
app.use(
  contextStorage(),
  requestId({ generator: () => randomBase64Url(6) }),
  requestLog({ write: log, skipPaths: ["/api/health"] }),
  parseAuth,
)

app.get(
  "/health",
  async (c: Context<APIContext>) =>
    c.json({
      status: "ok",
      isDbConnected: await db.isConnected(),
      date: Date.now(),
    }),
)
app.route("/auth", authRoute) // has some public routes and some more protected
app.route("/users", usersRoute)
app.route("/push", pushNotificationRoute)
app.route("/ws", wsRoute)
const groupListCursor = new GroupListCursorCodec(config.authCookieSecret)
app.route(
  "/groups",
  createGroupsRoute({
    create: (command) => commandBus.execute(command),
    list: (query) => queryBus.execute(query),
    cursor: groupListCursor,
  }),
)
if (config.isDev) {
  const { devRoute } = await import("./routes/dev.ts")
  app.route("/test", devRoute)
}

export default app
