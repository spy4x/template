import { Hono } from "hono"
import { contextStorage } from "hono/context-storage"
import { requestId } from "hono/request-id"
import { requestLog } from "@spy4x/server/request-log"
import { db, sql } from "@api/services/db.ts"
import { config } from "@api/services/config.ts"
import { log } from "@api/services/log.ts"
import { parseAuth, signIn } from "@api/services/auth.ts"
import { eventBus } from "@api/services/eventBus.ts"
import { getWebPush } from "@api/services/webPush.ts"
import { APIContext } from "./_types.ts"
import { randomBase64Url } from "@spy4x/platform/tokens"
import { ONE_HOUR_IN_MILLISECONDS } from "@spy4x/platform/universal/time-constants"
import { startSessionExpiry } from "./services/session-expiry.ts"
import { createAuthRoute } from "./routes/auth.ts"
import { createPushNotificationRoute } from "./routes/pushNotification.ts"
import { createUsersRoute } from "./routes/users.ts"
import { wsRoute } from "./routes/ws.ts"
import { createGroupsRoute } from "./routes/groups.ts"
import { createNotesRoute } from "./routes/notes.ts"
import { createMutationGuards } from "./middlewares/mutation-guards.ts"
import { createTotpFailures } from "./services/totp-failures.ts"
import { createAuthRateLimits } from "./middlewares/auth-rate-limits.ts"
import { commandBus } from "./services/commandBus.ts"
import { queryBus } from "./services/queryBus.ts"
import { listenForGroupChanges } from "@server/groups/group-change-notify.ts"
import { groupListCursor } from "./services/group-list-cursor.ts"
import { noteListCursor } from "./services/note-list-cursor.ts"
import { realtime } from "./services/realtimeHub.ts"
import { createHealthRoute } from "./routes/health.ts"
import { isCacheConnected, kv } from "./services/cache.ts"
import { createRedisRateLimitStore } from "@spy4x/server/kv"
import "./cqrs/+init.ts"

const REALTIME_REVALIDATE_INTERVAL_MS = 15_000

const app = new Hono<APIContext>().basePath("/api")
app.use(
  contextStorage(),
  requestId({ generator: () => randomBase64Url(6) }),
  requestLog({ write: log, skipPaths: ["/api/health"] }),
  parseAuth,
)

app.route(
  "/health",
  createHealthRoute({
    isDbConnected: () => db.isConnected(),
    isCacheConnected,
  }),
)
// The browser sends the web app's origin; behind the TLS-terminating proxy the API sees `http://`.
const expectedOrigin = new URL(config.webAppUrl).origin
const mutationGuards = createMutationGuards(config.webAppUrl)
const emit = (event: Parameters<typeof eventBus.emit>[0]) => eventBus.emit(event)
// has some public routes and some more protected
const rateLimits = createAuthRateLimits({
  ...config.rateLimiter,
  store: (keyPrefix) => createRedisRateLimitStore(kv, { keyPrefix }),
  onStoreError: (error) => log("error: auth rate limit store failed and was let pass", error),
})
app.route(
  "/auth",
  createAuthRoute({
    signIn,
    emit,
    mutationGuards,
    rateLimits,
    totpFailures: createTotpFailures({ sql }),
  }),
)
app.route(
  "/users",
  createUsersRoute({
    auth: signIn.auth,
    mutationGuards,
    getProfile: (query) => queryBus.execute(query),
    updateProfile: (command) => commandBus.execute(command),
  }),
)
// Awaited here so a missing VAPID keys file stops the API at start-up, not at the first push call.
const webPush = await getWebPush()
app.route(
  "/push",
  createPushNotificationRoute({
    auth: signIn.auth,
    mutationGuards,
    getPublicKey: () => webPush.getPublicKey(),
    register: (command) => commandBus.execute(command),
    remove: (command) => commandBus.execute(command),
    list: (query) => queryBus.execute(query),
  }),
)
app.route("/ws", wsRoute)
// Before "/groups": its authentication middleware would otherwise answer for these paths too.
app.route(
  "/groups/:groupId/notes",
  createNotesRoute({
    create: (command) => commandBus.execute(command),
    update: (command) => commandBus.execute(command),
    delete: (command) => commandBus.execute(command),
    list: (query) => queryBus.execute(query),
    get: (query) => queryBus.execute(query),
    cursor: noteListCursor,
    expectedOrigin,
  }),
)
app.route(
  "/groups",
  createGroupsRoute({
    create: (command) => commandBus.execute(command),
    list: (query) => queryBus.execute(query),
    get: (query) => queryBus.execute(query),
    select: (command) => commandBus.execute(command),
    selected: (query) => queryBus.execute(query),
    cursor: groupListCursor,
    expectedOrigin,
  }),
)
if (config.isDev) {
  const { createDevRoute } = await import("./routes/dev.ts")
  app.route(
    "/test",
    createDevRoute({
      isDev: config.isDev,
      db,
      sql,
      closeSockets: (userId) => realtime.closeUser(userId, "closed by a development script", 1012),
    }),
  )
}

// A change the worker announced reaches the members' open sockets as a sequence-stamped hint.
await listenForGroupChanges(sql, ({ groupId, sequence }) => {
  realtime.notifyGroupChange(groupId, sequence).catch((error) =>
    log(`error: cannot push the change of group ${groupId}`, error)
  )
})
// Sockets whose session was signed out, expired or lost its second factor while open are closed
// within this interval; the per-request check already refuses their frames.
realtime.startRevalidation(REALTIME_REVALIDATE_INTERVAL_MS)

// TODO: move this to a better place
// This is a temporary solution to expire sessions every hour
// This should be done in a more efficient way, like using a cron job or similar
const SESSION_EXPIRE_INTERVAL = ONE_HOUR_IN_MILLISECONDS
startSessionExpiry({
  expireSessions: () => signIn.expireSessions(),
  log,
  intervalMs: SESSION_EXPIRE_INTERVAL,
})

export default app
