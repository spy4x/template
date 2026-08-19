import { expect } from "@std/expect"
import { describe, it } from "@std/testing/bdd"
import { Hono } from "hono"
import {
  GroupCreateCommand,
  GroupError,
  GroupKind,
  GroupListQuery,
  GroupRole,
} from "@domain/groups"
import { SessionMFAStatus, UserMFAStatus } from "@shared/types"
import type { APIContext } from "../../apps/api/_types.ts"
import { createGroupsRoute, GroupsRouteDependencies } from "../../apps/api/routes/groups.ts"
import { buildAuthData } from "../helpers/fake-auth.ts"

const id = "7b6d8d6c-1af5-4f04-8ae4-b1ee5d111001"
const now = new Date("2026-08-18T10:00:00.000Z")

function buildApp(
  dependencies: GroupsRouteDependencies,
  auth = buildAuthData({ user: { id: 7 } }),
) {
  const app = new Hono<APIContext>()
  app.use("*", async (c, next) => {
    c.set("requestId", "req-groups-1")
    c.set("auth", auth)
    await next()
  })
  app.route("/groups", createGroupsRoute(dependencies))
  return app
}

function dependencies(): GroupsRouteDependencies & {
  createCommand: GroupCreateCommand | null
  listQuery: GroupListQuery | null
} {
  return {
    createCommand: null,
    listQuery: null,
    create(command) {
      this.createCommand = command
      return Promise.resolve({
        created: true,
        group: {
          id: command.data.id,
          kind: GroupKind.SHARED,
          name: command.data.name,
          role: GroupRole.OWNER,
          authorizationRevision: "1",
          updatedAt: now,
        },
      })
    },
    list(query) {
      this.listQuery = query
      return Promise.resolve({ groups: [], nextPageKey: null })
    },
    cursor: {
      encode: () => Promise.resolve("next-token"),
      decode: () => Promise.resolve({ updatedAt: now, id }),
    },
  }
}

const mutationHeaders = {
  "content-type": "application/json",
  cookie: "sessionIdToken=1:token",
  origin: "http://local",
  "sec-fetch-site": "same-origin",
}

describe("groups route", () => {
  it("derives create actor only from authenticated session", async () => {
    const deps = dependencies()
    const app = buildApp(deps)
    const response = await app.request("http://local/groups", {
      method: "POST",
      headers: mutationHeaders,
      body: JSON.stringify({ id, kind: GroupKind.SHARED, name: " Team " }),
    })

    expect(response.status).toBe(201)
    expect(deps.createCommand?.data).toEqual({
      userId: 7,
      id,
      kind: GroupKind.SHARED,
      name: "Team",
      requestId: "req-groups-1",
    })
  })

  it("rejects client identity and returns request id", async () => {
    const deps = dependencies()
    const app = buildApp(deps)
    const response = await app.request("http://local/groups", {
      method: "POST",
      headers: mutationHeaders,
      body: JSON.stringify({ id, kind: GroupKind.SHARED, name: "Team", userId: 999 }),
    })

    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({
      error: {
        code: "INVALID_REQUEST",
        message: "Request is invalid",
        requestId: "req-groups-1",
      },
    })
    expect(deps.createCommand).toBe(null)
  })

  it("scopes list to authenticated session", async () => {
    const deps = dependencies()
    const app = buildApp(deps, buildAuthData({ user: { id: 19 } }))
    const response = await app.request("http://local/groups")

    expect(response.status).toBe(200)
    expect(deps.listQuery?.data.userId).toBe(19)
    expect(deps.listQuery?.data.page).toEqual({ limit: 50, after: undefined })
  })

  it("decodes bounded pagination and returns next cursor", async () => {
    const deps = dependencies()
    deps.list = (query) => {
      deps.listQuery = query
      return Promise.resolve({
        groups: [],
        nextPageKey: { updatedAt: now, id },
      })
    }
    const app = buildApp(deps, buildAuthData({ user: { id: 19 } }))
    const response = await app.request("http://local/groups?limit=100&cursor=opaque")

    expect(response.status).toBe(200)
    expect(deps.listQuery?.data.page).toEqual({
      limit: 100,
      after: { updatedAt: now, id },
    })
    expect(await response.json()).toEqual({ groups: [], nextCursor: "next-token" })
  })

  it("rejects an over-limit group page", async () => {
    const deps = dependencies()
    const app = buildApp(deps)
    const response = await app.request("http://local/groups?limit=101")

    expect(response.status).toBe(400)
    expect(deps.listQuery).toBe(null)
  })

  it("requires completed configured MFA", async () => {
    const deps = dependencies()
    const app = buildApp(
      deps,
      buildAuthData({
        user: { mfa: UserMFAStatus.CONFIGURED },
        session: { mfa: SessionMFAStatus.NOT_REQUIRED },
      }),
    )
    const response = await app.request("http://local/groups")

    expect(response.status).toBe(401)
    expect(await response.json()).toEqual({
      error: {
        code: "MFA_REQUIRED",
        message: "Complete MFA to access groups",
        requestId: "req-groups-1",
      },
    })
  })

  it("maps typed conflicts to stable safe envelopes", async () => {
    const deps = dependencies()
    deps.create = () => {
      throw new GroupError("ID_ALREADY_EXISTS", "database-specific detail")
    }
    const app = buildApp(deps)
    const response = await app.request("http://local/groups", {
      method: "POST",
      headers: mutationHeaders,
      body: JSON.stringify({ id, kind: GroupKind.SHARED, name: "Team" }),
    })

    expect(response.status).toBe(409)
    expect(await response.json()).toEqual({
      error: {
        code: "ID_ALREADY_EXISTS",
        message: "Group id is already in use",
        requestId: "req-groups-1",
      },
    })
  })

  it("hides unexpected error details", async () => {
    const deps = dependencies()
    deps.list = () => {
      throw new Error("raw database text")
    }
    const app = buildApp(deps)
    const response = await app.request("http://local/groups")

    expect(response.status).toBe(500)
    expect(await response.json()).toEqual({
      error: {
        code: "INTERNAL_ERROR",
        message: "Internal server error",
        requestId: "req-groups-1",
      },
    })
  })
})
