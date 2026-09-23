import { Hono } from "hono"
import { APIContext } from "../_types.ts"
import { webPushService } from "@api/services/webPush.ts"
import { isAuthenticated2FA } from "@api/middlewares/auth.ts"
import { eventBus } from "@api/services/eventBus.ts"
import { PushDevicesUpdatedEvent } from "@api/cqrs/events.ts"
import { requestInfoFromContext } from "@spy4x/platform/request-info"
import { pushSubscribeRequestSchema, pushUnsubscribeRequestSchema } from "@spy4x/platform/model"
import { validate } from "@spy4x/validation"
export const pushNotificationRoute = new Hono<APIContext>()
  .use(isAuthenticated2FA)
  .get(`/public-key`, async (c) => {
    const publicKey = await webPushService.getPublicKey()
    return c.json({ publicKey })
  })
  .get(`/devices`, async (c) => {
    const userId = c.get("auth").user.id
    const deviceList = await webPushService.deviceList(userId)
    return c.json({ data: deviceList })
  })
  .post(`/`, async (c) => {
    const userId = c.get("auth").user.id
    const body = await c.req.json()
    const validationResult = validate(pushSubscribeRequestSchema, body)
    if (validationResult.error) {
      return c.json({ error: validationResult.error.description }, 400)
    }
    const { subscription, deviceId } = validationResult.data
    const userPushToken = await webPushService.subscribe(
      subscription,
      deviceId,
      userId,
    )
    const devices = await webPushService.deviceList(userId)
    eventBus.emit(
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
    const userId = c.get("auth").user.id
    const body = await c.req.json()
    const validationResult = validate(pushUnsubscribeRequestSchema, body)
    if (validationResult.error) {
      return c.json({ error: validationResult.error.description }, 400)
    }
    const { deviceId } = validationResult.data
    await webPushService.unsubscribe(deviceId, userId)
    const devices = await webPushService.deviceList(userId)
    eventBus.emit(
      new PushDevicesUpdatedEvent({
        userId,
        devices,
        // trustedProxy: true keeps the old behaviour of trusting X-Forwarded-For / X-Real-IP.
        request: requestInfoFromContext(c, { trustedProxy: true }),
      }),
    )
    return c.json({ isSuccess: true })
  })
