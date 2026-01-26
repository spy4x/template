import { Hono } from "hono"
import { contextStorage } from "hono/context-storage"
import { requestId } from "hono/request-id"
import { db } from "@api/services/db.ts"
import { config } from "@api/services/config.ts"
import { logger } from "@api/middlewares/log.ts"
import { parseAuth } from "@api/middlewares/auth.ts"
import { APIContext } from "./_types.ts"
import { getRandomString } from "@shared/helpers/random.ts"
import { authRoute } from "./routes/auth.ts"
import { pushNotificationRoute } from "./routes/pushNotification.ts"

const app = new Hono<APIContext>().basePath("/api")
app.use(
  contextStorage(),
  requestId({ generator: () => getRandomString(8) }),
  logger(),
  parseAuth,
)

app.get(
  "/health",
  async (c) =>
    c.json({
      status: "ok",
      isDbConnected: await db.isConnected(),
      date: Date.now(),
    }),
)
app.route("/auth", authRoute) // has some public routes and some more protected
app.route("/push", pushNotificationRoute)

export default app
