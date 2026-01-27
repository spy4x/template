/// <reference lib="deno.ns" />
import { expect } from "@std/expect"
import {
  validate,
  wsAuthSignedOutEventSchema,
  wsProfileEventSchema,
  wsProfileUpdatedEventSchema,
  wsPushDevicesUpdatedEventSchema,
  wsReadyEventSchema,
} from "@shared/types"

Deno.test("ws schema: accepts ready event", () => {
  const result = validate(wsReadyEventSchema, {
    kind: "ws.ready",
    payload: { requestId: "req-1" },
  })
  expect(result.error).toBeNull()
})

Deno.test("ws schema: accepts ready event without request id", () => {
  const result = validate(wsReadyEventSchema, {
    kind: "ws.ready",
    payload: {},
  })
  expect(result.error).toBeNull()
})

Deno.test("ws schema: accepts profile updated event", () => {
  const result = validate(wsProfileUpdatedEventSchema, {
    kind: "profile.updated",
    payload: {
      profile: {
        id: 1,
        userId: 1,
        displayName: "User",
        updatedBy: 1,
        createdAt: new Date(),
        updatedAt: new Date(),
        deletedAt: null,
      },
    },
  })
  expect(result.error).toBeNull()
})

Deno.test("ws schema: accepts push devices event", () => {
  const result = validate(wsPushDevicesUpdatedEventSchema, {
    kind: "push.devices.updated",
    payload: {
      devices: [
        {
          id: 1,
          userId: 1,
          deviceId: "device-1",
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ],
    },
  })
  expect(result.error).toBeNull()
})

Deno.test("ws schema: accepts auth signed out event", () => {
  const result = validate(wsAuthSignedOutEventSchema, {
    kind: "auth.signed_out",
    payload: { userId: 99 },
  })
  expect(result.error).toBeNull()
})

Deno.test("ws schema: rejects unknown event", () => {
  const result = validate(wsProfileEventSchema, {
    kind: "profile.deleted",
    payload: {},
  })
  expect(result.error).not.toBeNull()
})
