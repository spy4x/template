import { Hono } from "hono"
import type { Context, MiddlewareHandler } from "hono"
import {
  GroupCreateCommand,
  GroupCreateResult,
  GroupKind,
  GroupListPageKey,
  GroupListQuery,
  GroupListResult,
  parseCreateSharedGroupRequest,
} from "@domain/groups"
import type { Actor } from "@domain/identity"
import { APIContext } from "../_types.ts"
import { groupErrorResponse, GroupFeatureError } from "../features/groups/errors.ts"
import { createSameOriginMutationGuard } from "../middlewares/same-origin.ts"

export interface GroupsRouteDependencies {
  create(command: GroupCreateCommand): Promise<GroupCreateResult>
  list(query: GroupListQuery): Promise<GroupListResult>
  cursor: {
    encode(userId: number, pageKey: GroupListPageKey): Promise<string>
    decode(cursor: string, expectedUserId: number): Promise<GroupListPageKey>
  }
}

export function createGroupsRoute(dependencies: GroupsRouteDependencies): Hono<APIContext> {
  return new Hono<APIContext>()
    .onError((error, c) => groupErrorResponse(c, error))
    .use(requireGroupAuthentication)
    .get("/", async (c) => {
      const actor = actorFrom(c)
      const limit = parseLimit(c.req.query("limit"))
      const cursor = c.req.query("cursor")
      const after = cursor ? await dependencies.cursor.decode(cursor, actor.userId) : undefined
      const result = await dependencies.list(
        new GroupListQuery({ actor, page: { limit, after } }),
      )
      const nextCursor = result.nextPageKey
        ? await dependencies.cursor.encode(actor.userId, result.nextPageKey)
        : null
      return c.json({ groups: result.groups, nextCursor })
    })
    .post("/", requireSameOrigin, async (c) => {
      if (!c.req.header("content-type")?.toLowerCase().includes("application/json")) {
        throw new GroupFeatureError("INVALID_REQUEST", "Content type must be JSON")
      }
      let body: unknown
      try {
        body = await c.req.json()
      } catch {
        throw new GroupFeatureError("INVALID_REQUEST", "Request body must be JSON")
      }
      const input = parseCreateSharedGroupRequest(body)
      const result = await dependencies.create(
        new GroupCreateCommand({
          actor: actorFrom(c),
          id: input.id,
          kind: GroupKind.SHARED,
          name: input.name,
          requestId: c.get("requestId"),
        }),
      )
      return c.json({ group: result.group }, result.created ? 201 : 200)
    })
}

const requireSameOrigin = createSameOriginMutationGuard((c) =>
  groupErrorResponse(
    c,
    new GroupFeatureError("REQUEST_ORIGIN_INVALID", "Mutation origin check failed"),
  )
)

/**
 * Authentication only. Whether the session is good enough to perform the
 * operation is decided by the handler, so the WebSocket transport gets the same
 * answer without duplicating this.
 */
const requireGroupAuthentication: MiddlewareHandler<APIContext> = async (c, next) => {
  if (!c.get("auth")) {
    return groupErrorResponse(c, new GroupFeatureError("AUTH_REQUIRED", "Missing session"))
  }
  return await next()
}

function actorFrom(c: Context<APIContext>): Actor {
  const auth = c.get("auth")
  return {
    userId: auth.user.id,
    userMfa: auth.user.mfa,
    sessionMfa: auth.session.mfa,
  }
}

function parseLimit(value: string | undefined): number {
  if (value === undefined) {
    return 50
  }
  if (!/^\d+$/.test(value)) {
    throw new GroupFeatureError("INVALID_REQUEST", "Group list limit is invalid")
  }
  const limit = Number(value)
  if (limit < 1 || limit > 100) {
    throw new GroupFeatureError("INVALID_REQUEST", "Group list limit is invalid")
  }
  return limit
}
