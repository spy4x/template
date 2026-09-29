import type { Context } from "hono"
import type { ContentfulStatusCode } from "hono/utils/http-status"
import { GroupError, GroupErrorCode } from "@domain/groups"
import { AccessError } from "@domain/identity"
import { APIContext } from "../../_types.ts"

export type GroupFeatureErrorCode =
  | GroupErrorCode
  | "AUTH_REQUIRED"
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

export function groupErrorResponse(c: Context<APIContext>, error: unknown): Response {
  const code = error instanceof GroupFeatureError || error instanceof GroupError ||
      error instanceof AccessError
    ? error.code
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
