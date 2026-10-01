import { Hono } from "hono"
import type { Context, MiddlewareHandler } from "hono"
import {
  type DeletedGroupSummary,
  GroupCreateCommand,
  GroupCreateResult,
  GroupDeleteCommand,
  GroupDeletedListQuery,
  GroupGetQuery,
  GroupGetResult,
  GroupListPageKey,
  GroupListQuery,
  GroupListResult,
  GroupRenameCommand,
  GroupRestoreCommand,
  GroupSelectCommand,
  GroupSelectedQuery,
  type GroupSummary,
  parseCreateGroupRequest,
  parseGroupId,
  parseGroupIdRequest,
  parseRenameGroupBody,
  type SelectedGroup,
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
  select(command: GroupSelectCommand): Promise<SelectedGroup>
  selected(query: GroupSelectedQuery): Promise<SelectedGroup>
  rename(command: GroupRenameCommand): Promise<{ group: GroupSummary }>
  delete(command: GroupDeleteCommand): Promise<{ group: DeletedGroupSummary }>
  restore(command: GroupRestoreCommand): Promise<{ group: GroupSummary }>
  deleted(query: GroupDeletedListQuery): Promise<{ groups: DeletedGroupSummary[] }>
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
    // Before "/:groupId", which would otherwise read "selected" as a group id.
    .get("/selected", async (c) => {
      const actor = actorFromAuth(c.get("auth")!)
      return c.json(await dependencies.selected(new GroupSelectedQuery({ actor })))
    })
    // Before "/:groupId" too: "deleted" is not a group id.
    .get("/deleted", async (c) => {
      const actor = actorFromAuth(c.get("auth")!)
      return c.json(await dependencies.deleted(new GroupDeletedListQuery({ actor })))
    })
    .put("/selected", requireSameOrigin, async (c) => {
      const { groupId } = parseGroupIdRequest(await readJsonBody(c))
      return c.json(
        await dependencies.select(
          new GroupSelectCommand({
            actor: actorFromAuth(c.get("auth")!),
            groupId,
            requestId: c.get("requestId"),
            idempotencyKey: c.req.header("idempotency-key"),
          }),
        ),
      )
    })
    .get("/:groupId", async (c) => {
      const groupId = parseGroupId(c.req.param("groupId"))
      return c.json(
        await dependencies.get(
          new GroupGetQuery({ actor: actorFromAuth(c.get("auth")!), groupId }),
        ),
      )
    })
    .patch("/:groupId", requireSameOrigin, async (c) => {
      const groupId = parseGroupId(c.req.param("groupId"))
      const { name } = parseRenameGroupBody(await readJsonBody(c))
      return c.json(
        await dependencies.rename(
          new GroupRenameCommand({
            actor: actorFromAuth(c.get("auth")!),
            groupId,
            name,
            requestId: c.get("requestId"),
            idempotencyKey: c.req.header("idempotency-key"),
          }),
        ),
      )
    })
    .delete("/:groupId", requireSameOrigin, async (c) => {
      const groupId = parseGroupId(c.req.param("groupId"))
      return c.json(
        await dependencies.delete(
          new GroupDeleteCommand({
            actor: actorFromAuth(c.get("auth")!),
            groupId,
            requestId: c.get("requestId"),
            idempotencyKey: c.req.header("idempotency-key"),
          }),
        ),
      )
    })
    .post("/:groupId/restore", requireSameOrigin, async (c) => {
      const groupId = parseGroupId(c.req.param("groupId"))
      return c.json(
        await dependencies.restore(
          new GroupRestoreCommand({
            actor: actorFromAuth(c.get("auth")!),
            groupId,
            requestId: c.get("requestId"),
            idempotencyKey: c.req.header("idempotency-key"),
          }),
        ),
      )
    })
    .post("/", requireSameOrigin, async (c) => {
      const input = parseCreateGroupRequest(await readJsonBody(c))
      const result = await dependencies.create(
        new GroupCreateCommand({
          actor: actorFromAuth(c.get("auth")!),
          id: input.id,
          name: input.name,
          requestId: c.get("requestId"),
          idempotencyKey: c.req.header("idempotency-key"),
        }),
      )
      return c.json({ group: result.group }, result.created ? 201 : 200)
    })
}

/** The request's JSON body, or `INVALID_REQUEST` when it is not JSON or is declared as another type. */
async function readJsonBody(c: Context<APIContext>): Promise<unknown> {
  if (!c.req.header("content-type")?.toLowerCase().includes("application/json")) {
    throw new GroupFeatureError("INVALID_REQUEST", "Content type must be JSON")
  }
  try {
    return await readApiJson(c)
  } catch {
    throw new GroupFeatureError("INVALID_REQUEST", "Request body must be JSON")
  }
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
