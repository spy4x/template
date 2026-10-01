import type { Context } from "hono"
import type { ContentfulStatusCode } from "hono/utils/http-status"
import { NoteError, type NoteErrorCode, NoteVersionConflictError } from "@domain/notes"
import { AccessError } from "@domain/identity"
import { IdempotencyError } from "@spy4x/server/idempotency"
import type { APIContext } from "../../_types.ts"

export type NoteFeatureErrorCode =
  | NoteErrorCode
  | "AUTH_REQUIRED"
  | "IDEMPOTENCY_IN_PROGRESS"
  | "IDEMPOTENCY_KEY_INVALID"
  | "IDEMPOTENCY_KEY_REUSED"
  | "INTERNAL_ERROR"
  | "MFA_REQUIRED"
  | "REQUEST_ORIGIN_INVALID"

/** A refusal the REST route makes itself, before anything is dispatched. */
export class NoteFeatureError extends Error {
  constructor(
    public readonly code: NoteFeatureErrorCode,
    message: string,
  ) {
    super(message)
    this.name = "NoteFeatureError"
  }
}

interface ErrorDefinition {
  status: ContentfulStatusCode
  message: string
}

const ERROR_DEFINITIONS: Record<NoteFeatureErrorCode, ErrorDefinition> = {
  AUTH_REQUIRED: { status: 401, message: "Authentication required" },
  GROUP_NOT_FOUND: { status: 404, message: "Group not found" },
  ID_ALREADY_EXISTS: { status: 409, message: "Note id is already in use" },
  IDEMPOTENCY_IN_PROGRESS: {
    status: 409,
    message: "The first request with this idempotency key is still running",
  },
  IDEMPOTENCY_KEY_INVALID: { status: 400, message: "Idempotency key is invalid" },
  IDEMPOTENCY_KEY_REUSED: {
    status: 422,
    message: "Idempotency key was already used for a different request",
  },
  INTERNAL_ERROR: { status: 500, message: "Internal server error" },
  INVALID_CURSOR: { status: 400, message: "Note list cursor is invalid" },
  INVALID_REQUEST: { status: 400, message: "Request is invalid" },
  MFA_REQUIRED: { status: 401, message: "Complete MFA to access notes" },
  NOTE_NOT_FOUND: { status: 404, message: "Note not found" },
  REQUEST_ORIGIN_INVALID: { status: 403, message: "Request origin is invalid" },
  ROLE_INSUFFICIENT: { status: 403, message: "Only an editor can change notes" },
  VERSION_CONFLICT: { status: 409, message: "The note was changed by someone else" },
}

const IDEMPOTENCY_CODES: Record<IdempotencyError["code"], NoteFeatureErrorCode> = {
  INVALID_KEY: "IDEMPOTENCY_KEY_INVALID",
  KEY_REUSED: "IDEMPOTENCY_KEY_REUSED",
  IN_PROGRESS: "IDEMPOTENCY_IN_PROGRESS",
  INVALID_COMMAND: "INVALID_REQUEST",
}

/**
 * The JSON error of a note route. A version conflict also carries `currentVersion`, the version
 * the note is at now, so the client can reread it instead of overwriting a change it never saw.
 */
export function noteErrorResponse(c: Context<APIContext>, error: unknown): Response {
  const code: NoteFeatureErrorCode =
    error instanceof NoteFeatureError || error instanceof NoteError ||
      error instanceof AccessError
      ? error.code
      : error instanceof IdempotencyError
      ? IDEMPOTENCY_CODES[error.code]
      : "INTERNAL_ERROR"
  const definition = ERROR_DEFINITIONS[code]
  return c.json({
    error: {
      code,
      message: definition.message,
      requestId: c.get("requestId") || "unknown",
      ...(error instanceof NoteVersionConflictError
        ? { currentVersion: error.currentVersion }
        : {}),
    },
  }, definition.status)
}
