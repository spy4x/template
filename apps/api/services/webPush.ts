/// <reference lib="deno.ns" />
import * as webpush from "webpush"
import { encodeBase64Url } from "@std/encoding"
import { sql } from "@api/services/db.ts"
import { config } from "@api/services/config.ts"
import { createPushTokenStore } from "@api/services/push-token-store.ts"
import { WebPushService } from "@api/services/web-push-service.ts"

export { WebPushService }

/** Reads the VAPID keys from `config.vapidKeysPath` and builds the service over Postgres. */
async function createWebPushService(): Promise<WebPushService> {
  const vapidKeys = await webpush.importVapidKeys(
    JSON.parse(await Deno.readTextFile(config.vapidKeysPath)),
    { extractable: false },
  )
  const appServer = await webpush.ApplicationServer.new({
    contactInformation: "mailto:" + config.devEmail,
    vapidKeys,
  })
  return new WebPushService(
    appServer,
    createPushTokenStore(sql),
    encodeBase64Url(await crypto.subtle.exportKey("raw", vapidKeys.publicKey)),
  )
}

export const webPushService = await createWebPushService()
