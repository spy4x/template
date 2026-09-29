import { Hono } from "hono"
import type { Context } from "hono"
import { contextStorage } from "hono/context-storage"
import { requestId } from "hono/request-id"
import { requestLog } from "@spy4x/server/request-log"
import { db } from "@api/services/db.ts"
import { config } from "@api/services/config.ts"
import { log } from "@api/services/log.ts"
import { parseAuth, signIn } from "@api/services/auth.ts"
import { eventBus } from "@api/services/eventBus.ts"
import { webPushService } from "@api/services/webPush.ts"
import { APIContext } from "./_types.ts"
import { randomBase64Url } from "@spy4x/platform/tokens"
import { ONE_HOUR_IN_MILLISECONDS } from "@spy4x/platform/universal/time-constants"
import { createAuthRoute } from "./routes/auth.ts"
import { createPushNotificationRoute } from "./routes/pushNotification.ts"
import { createUsersRoute } from "./routes/users.ts"
import { wsRoute } from "./routes/ws.ts"
import { createGroupsRoute } from "./routes/groups.ts"
import { createMutationGuards } from "./middlewares/mutation-guards.ts"
import { createAuthRateLimits } from "./middlewares/auth-rate-limits.ts"
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
// The browser sends the web app's origin; behind the TLS-terminating proxy the API sees `http://`.
const expectedOrigin = new URL(config.webAppUrl).origin
const mutationGuards = createMutationGuards(config.webAppUrl)
const emit = (event: Parameters<typeof eventBus.emit>[0]) => eventBus.emit(event)
// has some public routes and some more protected
const rateLimits = createAuthRateLimits(config.rateLimiter)
app.route("/auth", createAuthRoute({ signIn, emit, mutationGuards, rateLimits }))
app.route(
  "/users",
  createUsersRoute({
    auth: signIn.auth,
    mutationGuards,
    getProfile: (query) => queryBus.execute(query),
    updateProfile: (command) => commandBus.execute(command),
  }),
)
app.route(
  "/push",
  createPushNotificationRoute({ auth: signIn.auth, webPush: webPushService, emit, mutationGuards }),
)
app.route("/ws", wsRoute)
const groupListCursor = await GroupListCursorCodec.fromCookieSecret(config.authCookieSecret)
app.route(
  "/groups",
  createGroupsRoute({
    create: (command) => commandBus.execute(command),
    list: (query) => queryBus.execute(query),
    cursor: groupListCursor,
    expectedOrigin,
  }),
)
if (config.isDev) {
  const { devRoute } = await import("./routes/dev.ts")
  app.route("/test", devRoute)
}

// TODO: move this to a better place
// This is a temporary solution to expire sessions every hour
// This should be done in a more efficient way, like using a cron job or similar
const SESSION_EXPIRE_INTERVAL = ONE_HOUR_IN_MILLISECONDS
setInterval(async () => {
  await signIn.expireSessions()
}, SESSION_EXPIRE_INTERVAL)

export default app
