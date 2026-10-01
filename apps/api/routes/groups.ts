import { Hono } from "hono"
import type { MiddlewareHandler } from "hono"
import {
  GroupCreateCommand,
  GroupCreateResult,
  GroupGetQuery,
  GroupGetResult,
  GroupKind,
  GroupListPageKey,
  GroupListQuery,
  GroupListResult,
  parseCreateSharedGroupRequest,
  parseGroupId,
} from "@domain/groups"
import { createSameOriginMutationGuard } from "@spy4x/server/http/same-origin"
import { actorFromAuth } from "../cqrs/actor.ts"
import { APIContext } from "../_types.ts"
import { groupErrorResponse, GroupFeatureError } from "../features/groups/errors.ts"
import { readApiJson } from "@api/services/json-body.ts"
import { listGroupsPage } from "../features/groups/list.ts"

export interface GroupsRouteDependencies {
  create(command: GroupCreateCommand): Promise<GroupCreateResult>
  list(query: GroupListQuery): Promise<GroupListResult>
  get(query: GroupGetQuery): Promise<GroupGetResult>
  cursor: {
    encode(userId: number, pageKey: GroupListPageKey): Promise<string>
    decode(cursor: string, expectedUserId: number): Promise<GroupListPageKey>
  }
  /**
   * The origin the browser sends, such as `https://app.example.com`. Behind the TLS-terminating
   * proxy the API sees `http://…`, so without it every mutation is refused. Defaults to the request
   * URL's own origin.
   */
  expectedOrigin?: string
}

export function createGroupsRoute(dependencies: GroupsRouteDependencies): Hono<APIContext> {
  const requireSameOrigin = createSameOriginMutationGuard<APIContext>({
    expectedOrigin: dependencies.expectedOrigin,
    onReject: (c) =>
      groupErrorResponse(
        c,
        new GroupFeatureError("REQUEST_ORIGIN_INVALID", "Mutation origin check failed"),
      ),
  })
  return new Hono<APIContext>()
    .onError((error, c) => groupErrorResponse(c, error))
    .use(requireGroupAuthentication)
    .get("/", async (c) => {
      const actor = actorFromAuth(c.get("auth")!)
      const limit = parseLimit(c.req.query("limit"))
      const page = await listGroupsPage(dependencies, actor, {
        limit,
        cursor: c.req.query("cursor"),
      })
      return c.json(page)
    })
    .get("/:groupId", async (c) => {
      const groupId = parseGroupId(c.req.param("groupId"))
      return c.json(
        await dependencies.get(
          new GroupGetQuery({ actor: actorFromAuth(c.get("auth")!), groupId }),
        ),
      )
    })
    .post("/", requireSameOrigin, async (c) => {
      if (!c.req.header("content-type")?.toLowerCase().includes("application/json")) {
        throw new GroupFeatureError("INVALID_REQUEST", "Content type must be JSON")
      }
      let body: unknown
      try {
        body = await readApiJson(c)
      } catch {
        throw new GroupFeatureError("INVALID_REQUEST", "Request body must be JSON")
      }
      const input = parseCreateSharedGroupRequest(body)
      const result = await dependencies.create(
        new GroupCreateCommand({
          actor: actorFromAuth(c.get("auth")!),
          id: input.id,
          kind: GroupKind.SHARED,
          name: input.name,
          requestId: c.get("requestId"),
          idempotencyKey: c.req.header("idempotency-key"),
        }),
      )
      return c.json({ group: result.group }, result.created ? 201 : 200)
    })
}

/**
 * Authentication only: is there a session at all. Whether the session is strong enough is decided
 * by the session gate on the CQRS buses (`apps/api/cqrs/session-gate.ts`), so every transport gets
 * the same answer without repeating the check.
 */
const requireGroupAuthentication: MiddlewareHandler<APIContext> = async (c, next) => {
  if (!c.get("auth")) {
    return groupErrorResponse(c, new GroupFeatureError("AUTH_REQUIRED", "Missing session"))
  }
  return await next()
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
