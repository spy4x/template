import { expect } from "@std/expect"
import { describe, it } from "@std/testing/bdd"
import type { PushTokenRecord, PushTokenStore } from "./push-token-store.ts"
import { type PushOptions, type PushSender, WebPushService } from "./web-push-service.ts"

const NOW = new Date("2026-09-30T10:00:00.000Z")

function memoryStore(rows: PushTokenRecord[] = []): PushTokenStore & { rows: PushTokenRecord[] } {
  const live = [...rows]
  return {
    rows: live,
    listByUser: (userId) => Promise.resolve(live.filter((row) => row.userId === userId)),
    upsert: (input) => {
      const row = { id: live.length + 1, ...input, createdAt: NOW, updatedAt: NOW }
      live.push(row)
      return Promise.resolve(row)
    },
    remove: ({ userId, deviceId }) => {
      const index = live.findIndex((row) => row.userId === userId && row.deviceId === deviceId)
      if (index >= 0) live.splice(index, 1)
      return Promise.resolve()
    },
  }
}

function token(userId: number, deviceId: string): PushTokenRecord {
  return {
    id: userId * 100 + Number(deviceId.slice(-1)),
    userId,
    deviceId,
    endpoint: `https://push.example/${userId}/${deviceId}`,
    auth: "auth",
    p256dh: "p256dh",
    createdAt: NOW,
    updatedAt: NOW,
  }
}

/** Records every push; an endpoint listed in `failures` rejects with that HTTP status. */
function fakeSender(failures: Record<string, number> = {}) {
  const sent: { endpoint: string; text: string; options: PushOptions }[] = []
  const sender: PushSender = {
    subscribe: (subscription) => ({
      pushTextMessage: (text, options) => {
        const status = failures[subscription.endpoint]
        if (status) {
          return Promise.reject(Object.assign(new Error("push failed"), {
            response: new Response(null, { status }),
          }))
        }
        sent.push({ endpoint: subscription.endpoint, text, options })
        return Promise.resolve()
      },
    }),
  }
  return { sender, sent }
}

const message = { title: "Hello", body: "World", url: null }

describe("WebPushService.send", () => {
  it("reaches only the target user's devices", async () => {
    const store = memoryStore([token(1, "d1"), token(1, "d2"), token(2, "d1")])
    const { sender, sent } = fakeSender()
    await new WebPushService(sender, store, "key").send(1, message)
    expect(sent.map((push) => push.endpoint).sort()).toEqual([
      "https://push.example/1/d1",
      "https://push.example/1/d2",
    ])
  })

  it("sends nothing for a user without subscriptions", async () => {
    const { sender, sent } = fakeSender()
    await new WebPushService(sender, memoryStore([token(2, "d1")]), "key").send(1, message)
    expect(sent).toEqual([])
  })

  it("passes the payload and the delivery options to the push service", async () => {
    const { sender, sent } = fakeSender()
    await new WebPushService(sender, memoryStore([token(1, "d1")]), "key").send(
      1,
      message,
      { urgency: "high", ttl: 60, topic: "news" },
    )
    expect(JSON.parse(sent[0].text)).toEqual(message)
    expect(sent[0].options).toEqual({ urgency: "high", ttl: 60, topic: "news" })
  })

  it("rejects an invalid payload before sending", async () => {
    const { sender, sent } = fakeSender()
    const service = new WebPushService(sender, memoryStore([token(1, "d1")]), "key")
    await expect(service.send(1, { title: 1 } as never)).rejects.toThrow("Invalid push payload")
    expect(sent).toEqual([])
  })

  for (const status of [404, 410]) {
    it(`deletes only the subscription the push service reports gone (${status})`, async () => {
      const store = memoryStore([token(1, "d1"), token(1, "d2"), token(2, "d1")])
      const { sender, sent } = fakeSender({ "https://push.example/1/d1": status })
      await new WebPushService(sender, store, "key").send(1, message)
      expect(store.rows.map((row) => `${row.userId}/${row.deviceId}`)).toEqual(["1/d2", "2/d1"])
      expect(sent.map((push) => push.endpoint)).toEqual(["https://push.example/1/d2"])
    })
  }

  it("keeps a subscription after a temporary failure and still tries the other devices", async () => {
    const store = memoryStore([token(1, "d1"), token(1, "d2")])
    const { sender, sent } = fakeSender({ "https://push.example/1/d1": 503 })
    const originalError = console.error
    console.error = () => {}
    try {
      await new WebPushService(sender, store, "key").send(1, message)
    } finally {
      console.error = originalError
    }
    expect(store.rows.length).toBe(2)
    expect(sent.map((push) => push.endpoint)).toEqual(["https://push.example/1/d2"])
  })
})

describe("WebPushService subscriptions", () => {
  it("stores the subscription for the user and sends a welcome push to it", async () => {
    const store = memoryStore()
    const { sender, sent } = fakeSender()
    const service = new WebPushService(sender, store, "key")
    const result = await service.subscribe(
      {
        endpoint: "https://push.example/new",
        keys: { auth: "a", p256dh: "p" },
        expirationTime: null,
      },
      "device-9",
      7,
    )
    expect(result).toEqual({
      id: 1,
      userId: 7,
      deviceId: "device-9",
      createdAt: NOW,
      updatedAt: NOW,
    })
    expect(store.rows[0].endpoint).toBe("https://push.example/new")
    expect(sent.map((push) => push.endpoint)).toEqual(["https://push.example/new"])
  })

  it("lists and removes only the given user's devices", async () => {
    const store = memoryStore([token(1, "d1"), token(2, "d1")])
    const service = new WebPushService(fakeSender().sender, store, "key")
    await service.unsubscribe("d1", 1)
    expect(await service.deviceList(1)).toEqual([])
    expect((await service.deviceList(2)).map((device) => device.deviceId)).toEqual(["d1"])
  })
})
