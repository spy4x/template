import type { Context } from "hono"
import type { ContentfulStatusCode } from "hono/utils/http-status"
import { GroupError, GroupErrorCode } from "@domain/groups"
import { AccessError } from "@domain/identity"
import { IdempotencyError } from "@spy4x/server/idempotency"
import { APIContext } from "../../_types.ts"

export type GroupFeatureErrorCode =
  | GroupErrorCode
  | "AUTH_REQUIRED"
  | "IDEMPOTENCY_IN_PROGRESS"
  | "IDEMPOTENCY_KEY_INVALID"
  | "IDEMPOTENCY_KEY_REUSED"
  | "INTERNAL_ERROR"
  | "MFA_REQUIRED"
  | "REQUEST_ORIGIN_INVALID"

export class GroupFeatureError extends Error {
  constructor(
    public readonly code: GroupFeatureErrorCode,
    message: string,
  ) {
    super(message)
    this.name = "GroupFeatureError"
  }
}

interface ErrorDefinition {
  status: ContentfulStatusCode
  message: string
}

const ERROR_DEFINITIONS: Record<GroupFeatureErrorCode, ErrorDefinition> = {
  AUTH_REQUIRED: { status: 401, message: "Authentication required" },
  GROUP_NOT_FOUND: { status: 404, message: "Group not found" },
  ID_ALREADY_EXISTS: { status: 409, message: "Group id is already in use" },
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
  INVALID_CURSOR: { status: 400, message: "Group list cursor is invalid" },
  INVALID_REQUEST: { status: 400, message: "Request is invalid" },
  LAST_OWNER: { status: 409, message: "Group must retain an owner" },
  MFA_REQUIRED: { status: 401, message: "Complete MFA to access groups" },
  PERSONAL_GROUP_IMMUTABLE: { status: 409, message: "Personal group cannot be changed" },
  REQUEST_ORIGIN_INVALID: { status: 403, message: "Request origin is invalid" },
  ROLE_INSUFFICIENT: { status: 403, message: "Group role is insufficient" },
  USER_NOT_ACTIVE: { status: 401, message: "Authentication required" },
}

const IDEMPOTENCY_CODES: Record<IdempotencyError["code"], GroupFeatureErrorCode> = {
  INVALID_KEY: "IDEMPOTENCY_KEY_INVALID",
  KEY_REUSED: "IDEMPOTENCY_KEY_REUSED",
  IN_PROGRESS: "IDEMPOTENCY_IN_PROGRESS",
  INVALID_COMMAND: "INTERNAL_ERROR",
}

export function groupErrorResponse(c: Context<APIContext>, error: unknown): Response {
  const code = error instanceof GroupFeatureError || error instanceof GroupError ||
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
    },
  }, definition.status)
}
