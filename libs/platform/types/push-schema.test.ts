import { expect } from "@std/expect"
import { pushSubscribeRequestSchema, pushUnsubscribeRequestSchema, validate } from "@platform/types"
Deno.test("push schema: accepts subscribe", () => {
  const result = validate(pushSubscribeRequestSchema, {
    deviceId: "device-1",
    subscription: {
      endpoint: "https://push.test/endpoint",
      expirationTime: null,
      keys: { auth: "auth", p256dh: "p256dh" },
    },
  })
  expect(result.error).toBeNull()
})

Deno.test("push schema: rejects subscribe without keys", () => {
  const result = validate(pushSubscribeRequestSchema, {
    deviceId: "device-2",
    subscription: {
      endpoint: "https://push.test/endpoint",
      expirationTime: null,
      keys: { auth: "" },
    },
  })
  expect(result.error).not.toBeNull()
})

Deno.test("push schema: accepts unsubscribe", () => {
  const result = validate(pushUnsubscribeRequestSchema, { deviceId: "device-3" })
  expect(result.error).toBeNull()
})
