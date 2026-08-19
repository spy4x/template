import { GroupError, GroupListPageKey } from "@domain/groups"

interface GroupListCursorPayload {
  version: 1
  purpose: "groups.list"
  userId: number
  updatedAt: string
  id: string
}

const CURSOR_KEYS = ["id", "purpose", "updatedAt", "userId", "version"]
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

export class GroupListCursorCodec {
  private readonly key: Promise<CryptoKey>

  constructor(secret: string) {
    this.key = crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(secret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign", "verify"],
    )
  }

  async encode(userId: number, pageKey: GroupListPageKey): Promise<string> {
    const payload: GroupListCursorPayload = {
      version: 1,
      purpose: "groups.list",
      userId,
      updatedAt: pageKey.updatedAt.toISOString(),
      id: pageKey.id,
    }
    const encodedPayload = encodeBase64Url(new TextEncoder().encode(JSON.stringify(payload)))
    const signature = await crypto.subtle.sign(
      "HMAC",
      await this.key,
      new TextEncoder().encode(encodedPayload),
    )
    return `${encodedPayload}.${encodeBase64Url(new Uint8Array(signature))}`
  }

  async decode(cursor: string, expectedUserId: number): Promise<GroupListPageKey> {
    try {
      const [encodedPayload, encodedSignature, extra] = cursor.split(".")
      if (!encodedPayload || !encodedSignature || extra) {
        throw new Error("Malformed cursor")
      }
      const valid = await crypto.subtle.verify(
        "HMAC",
        await this.key,
        decodeBase64Url(encodedSignature).buffer as ArrayBuffer,
        new TextEncoder().encode(encodedPayload),
      )
      if (!valid) {
        throw new Error("Invalid signature")
      }
      const payload = JSON.parse(new TextDecoder().decode(decodeBase64Url(encodedPayload)))
      if (!isCursorPayload(payload, expectedUserId)) {
        throw new Error("Invalid payload")
      }
      return { updatedAt: new Date(payload.updatedAt), id: payload.id }
    } catch (error) {
      if (error instanceof GroupError) {
        throw error
      }
      throw new GroupError("INVALID_CURSOR", "Group list cursor is invalid")
    }
  }
}

function isCursorPayload(value: unknown, expectedUserId: number): value is GroupListCursorPayload {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false
  }
  const payload = value as Record<string, unknown>
  if (Object.keys(payload).sort().join(",") !== CURSOR_KEYS.join(",")) {
    return false
  }
  if (
    payload.version !== 1 || payload.purpose !== "groups.list" ||
    payload.userId !== expectedUserId || typeof payload.updatedAt !== "string" ||
    typeof payload.id !== "string" || !UUID_PATTERN.test(payload.id)
  ) {
    return false
  }
  const date = new Date(payload.updatedAt)
  return !Number.isNaN(date.valueOf()) && date.toISOString() === payload.updatedAt
}

function encodeBase64Url(value: Uint8Array): string {
  return btoa(String.fromCharCode(...value))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "")
}

function decodeBase64Url(value: string): Uint8Array {
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/")
  const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, "=")
  return Uint8Array.from(atob(padded), (character) => character.charCodeAt(0))
}
