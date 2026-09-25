import { expect } from "@std/expect"
import { describe, it } from "@std/testing/bdd"
import { type } from "arktype"
import { decodeBase64Url } from "@std/encoding"
import { createSignedPayloadCodec } from "@spy4x/platform/signed-payload"
import { GroupError } from "@domain/groups"
import { deriveCursorSecret, GroupListCursorCodec } from "./group-list-cursor.ts"

const secret = "group-list-cursor-test-secret-0123456789"
const pageKey = {
  updatedAt: new Date("2026-08-18T10:00:00.000Z"),
  id: "7b6d8d6c-1af5-4f04-8ae4-b1ee5d111001",
}

/** Signs any JSON payload the way the cursor codec does, to forge cursors the encoder never mints. */
function rawCodec(purpose = "groups.list") {
  return createSignedPayloadCodec({ secret, purpose, version: 1, schema: type("object") })
}

async function expectInvalidCursor(promise: Promise<unknown>) {
  const error = await promise.then(() => null, (caught) => caught)
  expect(error).toBeInstanceOf(GroupError)
  expect((error as GroupError).code).toBe("INVALID_CURSOR")
}

describe("group list cursor", () => {
  it("round-trips a user-bound keyset", async () => {
    const codec = new GroupListCursorCodec(secret)
    const cursor = await codec.encode(7, pageKey)

    expect(await codec.decode(cursor, 7)).toEqual(pageKey)
  })

  it("keeps the user id out of the token", async () => {
    const codec = new GroupListCursorCodec(secret)
    const cursor = await codec.encode(987654, pageKey)
    const envelope = new TextDecoder().decode(decodeBase64Url(cursor.split(".")[0]))

    expect(envelope).not.toContain("987654")
    expect(JSON.parse(envelope).payload).toEqual({
      updatedAt: "2026-08-18T10:00:00.000Z",
      id: pageKey.id,
    })
  })

  it("rejects payload or signature tampering", async () => {
    const codec = new GroupListCursorCodec(secret)
    const cursor = await codec.encode(7, pageKey)
    const [payload, signature] = cursor.split(".")
    const flip = (value: string) => `${value[0] === "A" ? "B" : "A"}${value.slice(1)}`

    await expectInvalidCursor(codec.decode(`${flip(payload)}.${signature}`, 7))
    await expectInvalidCursor(codec.decode(`${payload}.${flip(signature)}`, 7))
  })

  it("rejects cursor reuse by another user", async () => {
    const codec = new GroupListCursorCodec(secret)
    const cursor = await codec.encode(7, pageKey)

    await expectInvalidCursor(codec.decode(cursor, 8))
  })

  it("rejects a cursor signed with another secret", async () => {
    const cursor = await new GroupListCursorCodec(secret).encode(7, pageKey)
    const other = new GroupListCursorCodec("another-group-list-cursor-secret-9876")

    await expectInvalidCursor(other.decode(cursor, 7))
  })

  it("rejects a cursor signed for another purpose", async () => {
    const cursor = await rawCodec("unsubscribe").sign(
      { updatedAt: "2026-08-18T10:00:00.000Z", id: pageKey.id },
      { context: "7" },
    )

    await expectInvalidCursor(new GroupListCursorCodec(secret).decode(cursor, 7))
  })

  it("decodes a well-formed payload signed outside the encoder", async () => {
    const cursor = await rawCodec().sign(
      { updatedAt: "2026-08-18T10:00:00.000Z", id: pageKey.id },
      { context: "7" },
    )

    expect(await new GroupListCursorCodec(secret).decode(cursor, 7)).toEqual(pageKey)
  })

  it("rejects a signed updatedAt that does not round-trip through toISOString", async () => {
    const cursor = await rawCodec().sign(
      { updatedAt: "2026-08-18T10:00:00Z", id: pageKey.id },
      { context: "7" },
    )

    await expectInvalidCursor(new GroupListCursorCodec(secret).decode(cursor, 7))
  })

  it("rejects a signed id that is not a UUID", async () => {
    const cursor = await rawCodec().sign(
      { updatedAt: "2026-08-18T10:00:00.000Z", id: "not-a-uuid" },
      { context: "7" },
    )

    await expectInvalidCursor(new GroupListCursorCodec(secret).decode(cursor, 7))
  })

  it("rejects a signed payload with an extra key", async () => {
    const cursor = await rawCodec().sign(
      { updatedAt: "2026-08-18T10:00:00.000Z", id: pageKey.id, userId: 7 },
      { context: "7" },
    )

    await expectInvalidCursor(new GroupListCursorCodec(secret).decode(cursor, 7))
  })

  it("rejects a cursor with an invalid base64url character", async () => {
    const codec = new GroupListCursorCodec(secret)
    const cursor = await codec.encode(7, pageKey)
    const [payload, signature] = cursor.split(".")

    await expectInvalidCursor(codec.decode(`${payload}.!${signature.slice(1)}`, 7))
  })

  it("rejects a cursor minted before the signed-payload codec", async () => {
    // The previous hand-rolled format, signed with this test's own secret: base64url JSON carrying
    // userId and purpose, then HMAC-SHA-256 over that segment alone.
    const minted =
      "eyJ2ZXJzaW9uIjoxLCJwdXJwb3NlIjoiZ3JvdXBzLmxpc3QiLCJ1c2VySWQiOjcsInVwZGF0ZWRBdCI6IjIwMjYtMDgtMThUMTA6MDA6MDAuMDAwWiIsImlkIjoiN2I2ZDhkNmMtMWFmNS00ZjA0LThhZTQtYjFlZTVkMTExMDAxIn0.s9ykeqv9qaIjt1GTl1mb8GL1o7Gz8v1sgq2LiiTJKhs"

    await expectInvalidCursor(new GroupListCursorCodec(secret).decode(minted, 7))
  })

  it("refuses a secret shorter than 32 characters", () => {
    expect(() => new GroupListCursorCodec("cursor-secret")).toThrow("at least 32 characters")
  })

  it("round-trips through a codec keyed from the cookie secret", async () => {
    const codec = await GroupListCursorCodec.fromCookieSecret(secret)
    const cursor = await codec.encode(7, pageKey)

    expect(await codec.decode(cursor, 7)).toEqual(pageKey)
  })

  it("signs with a key that is not the raw cookie secret", async () => {
    const cursor = await (await GroupListCursorCodec.fromCookieSecret(secret)).encode(7, pageKey)

    expect(await deriveCursorSecret(secret)).not.toBe(secret)
    await expectInvalidCursor(new GroupListCursorCodec(secret).decode(cursor, 7))
  })
})
