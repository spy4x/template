import { Hono } from "hono"
import { APIContext } from "../_types.ts"
import type { WebPushService } from "@api/services/webPush.ts"
import type { SignIn } from "@api/services/sign-in.ts"
import { PushDevicesUpdatedEvent } from "@api/cqrs/events.ts"
import { requestInfoFromContext } from "@spy4x/platform/request-info"
import { pushSubscribeRequestSchema, pushUnsubscribeRequestSchema } from "@spy4x/platform/model"
import { validate } from "@spy4x/validation"

/** What the push routes call. `index.ts` passes the app's singletons; tests pass fakes. */
export interface PushNotificationRouteDependencies {
  auth: Pick<SignIn["auth"], "isAuthenticated2FA">
  webPush: Pick<WebPushService, "getPublicKey" | "deviceList" | "subscribe" | "unsubscribe">
  emit(event: PushDevicesUpdatedEvent): void
}

export function createPushNotificationRoute(
  { auth, webPush, emit }: PushNotificationRouteDependencies,
): Hono<APIContext> {
  return new Hono<APIContext>()
    .use(auth.isAuthenticated2FA)
    .get(`/public-key`, async (c) => {
      const publicKey = await webPush.getPublicKey()
      return c.json({ publicKey })
    })
    .get(`/devices`, async (c) => {
      const userId = c.get("auth")!.user.id
      const deviceList = await webPush.deviceList(userId)
      return c.json({ data: deviceList })
    })
    .post(`/`, async (c) => {
      const userId = c.get("auth")!.user.id
      const body = await c.req.json()
      const validationResult = validate(pushSubscribeRequestSchema, body)
      if (validationResult.error) {
        return c.json({ error: validationResult.error.description }, 400)
      }
      const { subscription, deviceId } = validationResult.data
      const userPushToken = await webPush.subscribe(
        subscription,
        deviceId,
        userId,
      )
      const devices = await webPush.deviceList(userId)
      emit(
        new PushDevicesUpdatedEvent({
          userId,
          devices,
          // trustedProxy: true keeps the old behaviour of trusting X-Forwarded-For / X-Real-IP.
          request: requestInfoFromContext(c, { trustedProxy: true }),
        }),
      )
      return c.json({ userPushToken })
    })
    .delete("/", async (c) => {
      const userId = c.get("auth")!.user.id
      const body = await c.req.json()
      const validationResult = validate(pushUnsubscribeRequestSchema, body)
      if (validationResult.error) {
        return c.json({ error: validationResult.error.description }, 400)
      }
      const { deviceId } = validationResult.data
      await webPush.unsubscribe(deviceId, userId)
      const devices = await webPush.deviceList(userId)
      emit(
        new PushDevicesUpdatedEvent({
          userId,
          devices,
          // trustedProxy: true keeps the old behaviour of trusting X-Forwarded-For / X-Real-IP.
          request: requestInfoFromContext(c, { trustedProxy: true }),
        }),
      )
      return c.json({ isSuccess: true })
    })
}
