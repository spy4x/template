import { type } from "arktype"
import { createSignedPayloadCodec, type SignedPayloadCodec } from "@spy4x/platform/signed-payload"
import { encodeHex } from "@std/encoding"
import { GroupError, GroupListPageKey } from "@domain/groups"

/** Label the cursor key is derived under. Changing it invalidates every issued cursor. */
const KEY_LABEL = "template:group-list-cursor:v1"

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

/**
 * The signed page key. `updatedAt` must be exactly what `Date.prototype.toISOString` prints, so
 * a decoded cursor names the same instant the encoder saw. No other keys are accepted.
 */
const cursorPayload = type({
  updatedAt: type("string").narrow((value) => {
    const date = new Date(value)
    return !Number.isNaN(date.valueOf()) && date.toISOString() === value
  }),
  id: type(UUID_PATTERN),
  "+": "reject",
})

/**
 * Opaque group-list pagination cursor, signed with HMAC-SHA-256 under the purpose `groups.list`.
 * The signed-in user id is bound as the codec's context, not carried in the token, so a cursor
 * copied to another account fails its signature check. Every refusal is
 * `GroupError("INVALID_CURSOR")`.
 */
export class GroupListCursorCodec {
  private readonly codec: SignedPayloadCodec<typeof cursorPayload>

  /**
   * Builds the codec on a key derived from the session-cookie secret: the hex HMAC-SHA-256 of a
   * fixed label under that secret. Hono's signed cookie is an HMAC of the bare cookie value under
   * the raw secret, so signing cursors with the raw secret would let a cursor's MAC input and
   * signature pass as a signed cookie. The derived key keeps the two apart without a second
   * environment variable.
   *
   * @throws {TokenError} When the cookie secret is shorter than 32 printable characters. The
   * derived key always passes that rule, so the cookie secret is checked first, by the same codec
   * rule.
   */
  static async fromCookieSecret(cookieSecret: string): Promise<GroupListCursorCodec> {
    new GroupListCursorCodec(cookieSecret)
    return new GroupListCursorCodec(await deriveCursorSecret(cookieSecret))
  }

  /** @throws {TokenError} When the secret is shorter than 32 printable characters. */
  constructor(secret: string) {
    this.codec = createSignedPayloadCodec({
      secret,
      purpose: "groups.list",
      version: 1,
      schema: cursorPayload,
    })
  }

  encode(userId: number, pageKey: GroupListPageKey): Promise<string> {
    return this.codec.sign(
      { updatedAt: pageKey.updatedAt.toISOString(), id: pageKey.id },
      { context: String(userId) },
    )
  }

  async decode(cursor: string, expectedUserId: number): Promise<GroupListPageKey> {
    const result = await this.codec.verify(cursor, { context: String(expectedUserId) })
    if (!result.ok) {
      throw new GroupError("INVALID_CURSOR", "Group list cursor is invalid")
    }
    return { updatedAt: new Date(result.value.updatedAt), id: result.value.id }
  }
}

/** Hex HMAC-SHA-256 of {@link KEY_LABEL} under `cookieSecret`: 64 printable characters. */
export async function deriveCursorSecret(cookieSecret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(cookieSecret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  )
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(KEY_LABEL))
  return encodeHex(new Uint8Array(mac))
}
