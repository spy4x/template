import { type } from "arktype"
import { createSignedPayloadCodec, type SignedPayloadCodec } from "@spy4x/platform/signed-payload"
import { NoteError, type NoteListPageKey } from "@domain/notes"
import { deriveCursorSecret } from "@server/groups/group-list-cursor.ts"

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

/** The signed page key, in the same shape as the group list's. No other keys are accepted. */
const cursorPayload = type({
  updatedAt: type("string").narrow((value) => {
    const date = new Date(value)
    return !Number.isNaN(date.valueOf()) && date.toISOString() === value
  }),
  id: type(UUID_PATTERN),
  "+": "reject",
})

/**
 * Opaque note-list pagination cursor, signed with HMAC-SHA-256 under the purpose `notes.list`.
 * The user and the group are bound as the codec's context, not carried in the token, so a cursor
 * copied to another account or another group fails its signature check. Every refusal is
 * `NoteError("INVALID_CURSOR")`.
 *
 * It signs with the key the group list's cursor derives from the cookie secret; the purpose keeps
 * the two kinds of cursor apart.
 */
export class NoteListCursorCodec {
  private readonly codec: SignedPayloadCodec<typeof cursorPayload>

  /** @throws {TokenError} When the cookie secret is shorter than 32 printable characters. */
  static async fromCookieSecret(cookieSecret: string): Promise<NoteListCursorCodec> {
    new NoteListCursorCodec(cookieSecret)
    return new NoteListCursorCodec(await deriveCursorSecret(cookieSecret))
  }

  /** @throws {TokenError} When the secret is shorter than 32 printable characters. */
  constructor(secret: string) {
    this.codec = createSignedPayloadCodec({
      secret,
      purpose: "notes.list",
      version: 1,
      schema: cursorPayload,
    })
  }

  encode(userId: number, groupId: string, pageKey: NoteListPageKey): Promise<string> {
    return this.codec.sign(
      { updatedAt: pageKey.updatedAt.toISOString(), id: pageKey.id },
      { context: `${userId}:${groupId}` },
    )
  }

  async decode(cursor: string, userId: number, groupId: string): Promise<NoteListPageKey> {
    const result = await this.codec.verify(cursor, { context: `${userId}:${groupId}` })
    if (!result.ok) {
      throw new NoteError("INVALID_CURSOR", "Note list cursor is invalid")
    }
    return { updatedAt: new Date(result.value.updatedAt), id: result.value.id }
  }
}
