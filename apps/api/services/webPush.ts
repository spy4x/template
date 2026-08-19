/// <reference lib="deno.ns" />
import * as webpush from "webpush"
import { encodeBase64Url } from "@std/encoding"
import { db } from "@api/services/db.ts"
import { config } from "@api/services/config.ts"
import type { PushNotificationMessage, PushSubscribeRequest } from "@platform/types"
import type { UserPushTokenPublic } from "@domain/identity"
import { pushNotificationMessageSchema, validate } from "@platform/types"
type Subscriptions = { [deviceId: string]: webpush.PushSubscriber }

export class WebPushService {
  appServer: webpush.ApplicationServer
  subscriptions: Subscriptions
  publicKey: CryptoKey
  encodedPublicKey: string

  constructor(
    appServer: webpush.ApplicationServer,
    subscriptions: Subscriptions,
    vapidKeys: CryptoKeyPair,
    encodedPublicKey: string,
  ) {
    this.appServer = appServer
    this.subscriptions = subscriptions
    this.publicKey = vapidKeys.publicKey
    this.encodedPublicKey = encodedPublicKey
  }

  static async new() {
    const vapidKeysString = await Deno.readTextFile(config.vapidKeysPath)
    const contactInformation = "mailto:" + config.devEmail
    const vapidKeys = await webpush.importVapidKeys(
      JSON.parse(vapidKeysString),
      {
        extractable: false,
      },
    )
    const appServer = await webpush.ApplicationServer.new({
      contactInformation,
      vapidKeys,
    })
    return new WebPushService(
      appServer,
      {},
      vapidKeys,
      encodeBase64Url(
        await crypto.subtle.exportKey(
          "raw",
          vapidKeys.publicKey,
        ),
      ),
    )
  }

  public getPublicKey(): string {
    return this.encodedPublicKey
  }

  public async subscribe(
    subscription: PushSubscribeRequest["subscription"],
    deviceId: string,
    userId: number,
  ): Promise<UserPushTokenPublic> {
    this.subscriptions[deviceId] = this.appServer.subscribe(subscription)
    let userPushToken = undefined
    const existingToken = await db.userPushToken.findOne({ deviceId, userId })
    if (existingToken) {
      userPushToken = await db.userPushToken.updateOne({
        id: existingToken.id,
        data: {
          endpoint: subscription.endpoint,
          auth: subscription.keys.auth,
          p256dh: subscription.keys.p256dh,
        },
      })
    } else {
      userPushToken = await db.userPushToken.createOne({
        data: {
          userId,
          deviceId,
          endpoint: subscription.endpoint,
          auth: subscription.keys.auth,
          p256dh: subscription.keys.p256dh,
        },
      })
    }

    this.subscriptions[deviceId].pushTextMessage(
      JSON.stringify({
        title: "✅ Test Push Notification",
        body: "You are now subscribed",
      }),
      {},
    )

    return {
      id: userPushToken.id,
      userId,
      deviceId,
      createdAt: userPushToken.createdAt,
      updatedAt: userPushToken.updatedAt,
    }
  }

  public async deviceList(userId: number): Promise<UserPushTokenPublic[]> {
    const deviceList = await db.userPushToken.findMany({ userId })
    return deviceList.map(({ id, userId, deviceId, createdAt, updatedAt }) => ({
      id,
      userId,
      deviceId,
      createdAt,
      updatedAt,
    }))
  }

  public async unsubscribe(deviceId: string, userId?: number): Promise<void> {
    await db.userPushToken.deleteOne({ deviceId, userId })
    if (this.subscriptions[deviceId]) {
      delete this.subscriptions[deviceId]
    }
  }

  public async send(
    message: PushNotificationMessage,
    urgency?: webpush.Urgency,
    ttl?: number,
    topic?: string,
  ): Promise<void> {
    const validationResult = validate(pushNotificationMessageSchema, message)
    if (validationResult.error) {
      throw new Error(`Invalid push payload: ${validationResult.error.description}`)
    }
    const payload = validationResult.data
    const options: webpush.PushMessageOptions = {
      urgency,
      ttl,
      topic,
    }
    const deviceIds = Object.keys(this.subscriptions)
    for (const deviceId of deviceIds) {
      try {
        await this.subscriptions[deviceId].pushTextMessage(
          JSON.stringify(payload),
          options,
        )
      } catch (error) {
        if (
          error && typeof error === "object" &&
          "response" in error && error.response instanceof Response &&
          error.response.status === 410
        ) {
          console.log("Subscription is no longer valid, deleting", {
            deviceId,
          })
          await this.unsubscribe(deviceId)
        } else {
          console.error("Error sending push notification", error, {
            deviceId,
            message,
          })
        }
      }
    }
  }
}

export const webPushService = await WebPushService.new()
