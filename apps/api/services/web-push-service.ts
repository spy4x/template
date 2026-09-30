import type { PushNotificationMessage, PushSubscribeRequest } from "@spy4x/platform/model"
import { pushNotificationMessageSchema } from "@spy4x/platform/model"
import type { UserPushTokenPublic } from "@domain/identity"
import { validate } from "@spy4x/validation"
import type { PushTokenRecord, PushTokenStore } from "./push-token-store.ts"

/** How urgently the push service should deliver (RFC 8030). */
export type PushUrgency = "very-low" | "low" | "normal" | "high"

/** Delivery options of one push. */
export interface PushOptions {
  urgency?: PushUrgency
  /** Seconds the push service keeps the message while the device is offline. */
  ttl?: number
  /** Replaces a pending message with the same topic. */
  topic?: string
}

/** One browser subscription the API can push to. `@negrel/webpush`'s `PushSubscriber` fits. */
export interface PushTarget {
  pushTextMessage(message: string, options: PushOptions): Promise<void>
}

/** Builds a push target from a stored subscription. `@negrel/webpush`'s `ApplicationServer` fits. */
export interface PushSender {
  subscribe(subscription: { endpoint: string; keys: { auth: string; p256dh: string } }): PushTarget
}

/** HTTP statuses with which a push service says the subscription is gone for good. */
const GONE_STATUSES = new Set([404, 410])

function isGone(error: unknown): boolean {
  return !!error && typeof error === "object" && "response" in error &&
    error.response instanceof Response && GONE_STATUSES.has(error.response.status)
}

function toPublic(token: PushTokenRecord): UserPushTokenPublic {
  const { id, userId, deviceId, createdAt, updatedAt } = token
  return { id, userId, deviceId, createdAt, updatedAt }
}

/**
 * Web Push for signed-in users. Subscriptions live in Postgres (`store`), so they survive a
 * restart, and `send` reaches only the devices of the one user it is given.
 */
export class WebPushService {
  constructor(
    private readonly sender: PushSender,
    private readonly store: PushTokenStore,
    private readonly encodedPublicKey: string,
  ) {}

  public getPublicKey(): string {
    return this.encodedPublicKey
  }

  public async subscribe(
    subscription: PushSubscribeRequest["subscription"],
    deviceId: string,
    userId: number,
  ): Promise<UserPushTokenPublic> {
    const token = await this.store.upsert({
      userId,
      deviceId,
      endpoint: subscription.endpoint,
      auth: subscription.keys.auth,
      p256dh: subscription.keys.p256dh,
    })
    // A welcome push the push service reports gone deletes the row (see `push`), yet subscribe
    // still reports success: the browser handed us the subscription a moment ago.
    await this.push(
      token,
      JSON.stringify({ title: "✅ Test Push Notification", body: "You are now subscribed" }),
      {},
    )
    return toPublic(token)
  }

  public async deviceList(userId: number): Promise<UserPushTokenPublic[]> {
    return (await this.store.listByUser(userId)).map(toPublic)
  }

  public async unsubscribe(deviceId: string, userId: number): Promise<void> {
    await this.store.remove({ userId, deviceId })
  }

  /**
   * Pushes `message` to every device of `userId`, and to nobody else. A subscription the push
   * service reports gone (404 or 410) is deleted; any other failure is logged and the remaining
   * devices are still tried.
   */
  public async send(
    userId: number,
    message: PushNotificationMessage,
    options: PushOptions = {},
  ): Promise<void> {
    const validationResult = validate(pushNotificationMessageSchema, message)
    if (validationResult.error) {
      throw new Error(`Invalid push payload: ${validationResult.error.description}`)
    }
    const text = JSON.stringify(validationResult.data)
    for (const token of await this.store.listByUser(userId)) {
      await this.push(token, text, options)
    }
  }

  private async push(token: PushTokenRecord, text: string, options: PushOptions): Promise<void> {
    try {
      await this.sender
        .subscribe({ endpoint: token.endpoint, keys: { auth: token.auth, p256dh: token.p256dh } })
        .pushTextMessage(text, options)
    } catch (error) {
      if (isGone(error)) {
        console.log("Subscription is no longer valid, deleting", { deviceId: token.deviceId })
        await this.store.remove({ userId: token.userId, deviceId: token.deviceId })
      } else {
        console.error("Error sending push notification", error, { deviceId: token.deviceId })
      }
    }
  }
}
