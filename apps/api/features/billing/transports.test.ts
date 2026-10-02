import { expect } from "@std/expect"
import { describe, it } from "@std/testing/bdd"
import { Hono } from "hono"
import { CommandBus, QueryBus } from "@spy4x/platform/cqrs"
import type { BillingProvider, CheckoutRequest, PortalRequest } from "@spy4x/billing"
import { GroupRole } from "@domain/groups"
import {
  BillingCheckoutCommand,
  BillingGetQuery,
  BillingPortalCommand,
  BillingStatus,
  type StoredSubscription,
} from "@domain/billing"
import { createSessionGate } from "../../cqrs/session-gate.ts"
import { buildAuthData } from "../../_testing/fake-auth.ts"
import { roles } from "../../_testing/memory-notes.ts"
import type { APIContext } from "../../_types.ts"
import { createBillingRoute } from "../../routes/billing.ts"
import {
  createBillingCheckoutHandler,
  createBillingGetHandler,
  createBillingPortalHandler,
} from "./handlers.ts"

/**
 * The billing route over the real handlers on buses with the session gate, as the API wires them.
 * Only the repository and the provider are stand-ins, so a route that skipped the buses, or a
 * handler that skipped the owner check, fails here.
 */

const groupId = "7b6d8d6c-1af5-4f04-8ae4-b1ee5d111002"
const OWNER = 1
const ADMIN = 2
const EDITOR = 3
const VIEWER = 4
const STRANGER = 5

interface Recorder {
  checkouts: CheckoutRequest[]
  portals: PortalRequest[]
}

function fakeProvider(recorder: Recorder): BillingProvider {
  return {
    createCheckout(request) {
      recorder.checkouts.push(request)
      return Promise.resolve({ ok: true, value: { id: "cs_1", url: "https://pay.example/cs_1" } })
    },
    createPortalSession(request) {
      recorder.portals.push(request)
      return Promise.resolve({ ok: true, value: { id: "bps_1", url: "https://pay.example/p" } })
    },
    parseEvent: () => Promise.reject(new Error("not used")),
  }
}

function stack(
  { subscription = null, customer = null, enabled = true }: {
    subscription?: StoredSubscription | null
    customer?: string | null
    enabled?: boolean
  } = {},
) {
  const recorder: Recorder = { checkouts: [], portals: [] }
  const groups = roles({
    [`${groupId}:${OWNER}`]: GroupRole.OWNER,
    [`${groupId}:${ADMIN}`]: GroupRole.ADMIN,
    [`${groupId}:${EDITOR}`]: GroupRole.EDITOR,
    [`${groupId}:${VIEWER}`]: GroupRole.VIEWER,
  })
  const dependencies = {
    billing: {
      get: () => Promise.resolve(subscription),
      lockedRoleOf: (id: string, userId: number) => groups.roleOf(id, userId),
      customerOf: () => Promise.resolve(customer),
    },
    groups,
    provider: enabled ? fakeProvider(recorder) : null,
    webAppUrl: "https://app.example.com",
    log: () => {},
  }
  const commands = new CommandBus()
  commands.use(createSessionGate([]))
  commands.register(BillingCheckoutCommand, createBillingCheckoutHandler(dependencies))
  commands.register(BillingPortalCommand, createBillingPortalHandler(dependencies))
  const queries = new QueryBus()
  queries.use(createSessionGate([]))
  queries.register(BillingGetQuery, createBillingGetHandler(dependencies))
  const route = createBillingRoute({
    get: (query) => queries.execute(query),
    checkout: (command) => commands.execute(command),
    portal: (command) => commands.execute(command),
    expectedOrigin: "http://local",
  })
  const call = (
    userId: number,
    method: string,
    path: string,
    body?: unknown,
    extraHeaders: Record<string, string> = {},
  ) => {
    const app = new Hono<APIContext>()
    app.use("*", async (c, next) => {
      c.set("requestId", "req-billing")
      c.set("auth", buildAuthData({ user: { id: userId }, session: { userId } }))
      await next()
    })
    app.route("/groups/:groupId/billing", route)
    return app.request(`http://local/groups/${groupId}/billing${path}`, {
      method,
      headers: {
        "content-type": "application/json",
        cookie: "sessionIdToken=1:token",
        origin: "http://local",
        "sec-fetch-site": "same-origin",
        ...extraHeaders,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
  }
  return { recorder, call }
}

const PRO: StoredSubscription = {
  groupId,
  providerSubscriptionId: "sub_1",
  planId: "pro",
  status: BillingStatus.Active,
  currentPeriodEnd: new Date("2026-11-01T00:00:00Z"),
  cancelAtPeriodEnd: false,
}

async function code(response: Response): Promise<string> {
  return ((await response.json()) as { error: { code: string } }).error.code
}

describe("billing over REST", () => {
  for (
    const [name, userId] of [["admin", ADMIN], ["editor", EDITOR], ["viewer", VIEWER]] as const
  ) {
    it(`refuses checkout and the portal to an ${name} with 403 and never calls the provider`, async () => {
      const { recorder, call } = stack({ customer: "cus_1" })

      const checkout = await call(userId, "POST", "/checkout", { planId: "pro" })
      const portal = await call(userId, "POST", "/portal")

      expect([checkout.status, await code(checkout)]).toEqual([403, "ROLE_INSUFFICIENT"])
      expect([portal.status, await code(portal)]).toEqual([403, "ROLE_INSUFFICIENT"])
      expect(recorder).toEqual({ checkouts: [], portals: [] })
    })
  }

  it("answers a stranger as if the group did not exist", async () => {
    const { recorder, call } = stack({ customer: "cus_1" })

    const read = await call(STRANGER, "GET", "")
    const checkout = await call(STRANGER, "POST", "/checkout", { planId: "pro" })

    expect([read.status, await code(read)]).toEqual([404, "GROUP_NOT_FOUND"])
    expect([checkout.status, await code(checkout)]).toEqual([404, "GROUP_NOT_FOUND"])
    expect(recorder.checkouts).toEqual([])
  })

  it("opens the owner's checkout for the group, back to its pages, and answers the provider's URL", async () => {
    const { recorder, call } = stack({ customer: "cus_1" })

    const response = await call(OWNER, "POST", "/checkout", { planId: "pro" })

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ url: "https://pay.example/cs_1" })
    expect(recorder.checkouts).toEqual([{
      planId: "pro",
      successUrl: `https://app.example.com/groups/${groupId}`,
      cancelUrl: `https://app.example.com/groups/${groupId}/pricing`,
      reference: groupId,
      customerId: "cus_1",
    }])
  })

  it("refuses a checkout for the free plan or an unknown one", async () => {
    const { recorder, call } = stack()

    const free = await call(OWNER, "POST", "/checkout", { planId: "free" })
    const unknown = await call(OWNER, "POST", "/checkout", { planId: "gold" })

    expect([free.status, await code(free)]).toEqual([400, "UNKNOWN_PLAN"])
    expect([unknown.status, await code(unknown)]).toEqual([400, "UNKNOWN_PLAN"])
    expect(recorder.checkouts).toEqual([])
  })

  it("refuses a second checkout while the group pays", async () => {
    const { recorder, call } = stack({ subscription: PRO, customer: "cus_1" })

    const response = await call(OWNER, "POST", "/checkout", { planId: "pro" })

    expect([response.status, await code(response)]).toEqual([409, "ALREADY_SUBSCRIBED"])
    expect(recorder.checkouts).toEqual([])
  })

  for (
    const [name, subscription] of [
      ["paused", { ...PRO, status: BillingStatus.Paused }],
      ["incomplete", { ...PRO, status: BillingStatus.Incomplete }],
      ["on a price no plan maps to", { ...PRO, planId: null }],
    ] as const
  ) {
    it(`refuses a second checkout while the group's subscription is ${name}, though it shows as free`, async () => {
      const { recorder, call } = stack({ subscription, customer: "cus_1" })

      const response = await call(OWNER, "POST", "/checkout", { planId: "pro" })

      expect([response.status, await code(response)]).toEqual([409, "ALREADY_SUBSCRIBED"])
      expect(recorder.checkouts).toEqual([])
    })
  }

  it("opens a new checkout once the group's subscription is cancelled", async () => {
    const { recorder, call } = stack({
      subscription: { ...PRO, status: BillingStatus.Canceled },
      customer: "cus_1",
    })

    const response = await call(OWNER, "POST", "/checkout", { planId: "pro" })

    expect(response.status).toBe(200)
    expect(recorder.checkouts).toHaveLength(1)
  })

  it("scopes the client's idempotency key to the group and the owner", async () => {
    const { recorder, call } = stack()

    await call(OWNER, "POST", "/checkout", { planId: "pro" }, { "idempotency-key": "key-1" })

    expect(recorder.checkouts[0].idempotencyKey).toBe(`${groupId}:${OWNER}:key-1`)
  })

  it("tells the owner whether the group has a live subscription and a customer", async () => {
    const paused = stack({ subscription: { ...PRO, status: BillingStatus.Paused }, customer: "c" })
    const lapsed = stack({
      subscription: { ...PRO, status: BillingStatus.Canceled },
      customer: "c",
    })

    const live = await (await paused.call(OWNER, "GET", "")).json()
    const ended = await (await lapsed.call(OWNER, "GET", "")).json()

    expect(live.billing).toMatchObject({ planId: "free", subscribed: true, hasCustomer: true })
    expect(ended.billing).toMatchObject({ planId: "free", subscribed: false, hasCustomer: true })
  })

  it("opens the owner's portal for the group's customer, back to the group's settings", async () => {
    const { recorder, call } = stack({ subscription: PRO, customer: "cus_1" })

    const response = await call(OWNER, "POST", "/portal")

    expect(await response.json()).toEqual({ url: "https://pay.example/p" })
    expect(recorder.portals).toEqual([{
      customerId: "cus_1",
      returnUrl: `https://app.example.com/groups/${groupId}`,
    }])
  })

  it("refuses the portal of a group that never paid", async () => {
    const { call } = stack()

    const response = await call(OWNER, "POST", "/portal")

    expect([response.status, await code(response)]).toEqual([409, "NO_SUBSCRIPTION"])
  })

  it("shows every member the plan, and only the owner may manage it", async () => {
    const { call } = stack({ subscription: PRO })

    const owner = await (await call(OWNER, "GET", "")).json()
    const viewer = await (await call(VIEWER, "GET", "")).json()

    expect(owner.billing).toMatchObject({ enabled: true, planId: "pro", canManage: true })
    expect(viewer.billing).toMatchObject({ enabled: true, planId: "pro", canManage: false })
  })

  it("keeps every group on the free plan when billing is off, and answers checkout with 404", async () => {
    const { call } = stack({ subscription: PRO, enabled: false })

    const read = await (await call(OWNER, "GET", "")).json()
    const checkout = await call(OWNER, "POST", "/checkout", { planId: "pro" })

    expect(read.billing).toEqual({
      enabled: false,
      planId: "free",
      status: null,
      currentPeriodEnd: null,
      cancelAtPeriodEnd: false,
      canManage: false,
      subscribed: false,
      hasCustomer: false,
    })
    expect([checkout.status, await code(checkout)]).toEqual([404, "BILLING_DISABLED"])
  })

  it("refuses a cross-site checkout before it reaches the handler", async () => {
    const { recorder } = stack()
    const app = new Hono<APIContext>()
    app.use("*", async (c, next) => {
      c.set("requestId", "req-billing")
      c.set("auth", buildAuthData({ user: { id: OWNER }, session: { userId: OWNER } }))
      await next()
    })
    app.route(
      "/groups/:groupId/billing",
      createBillingRoute({
        get: () => Promise.reject(new Error("not reached")),
        checkout: () => Promise.reject(new Error("not reached")),
        portal: () => Promise.reject(new Error("not reached")),
        expectedOrigin: "http://local",
      }),
    )

    const response = await app.request(`http://local/groups/${groupId}/billing/checkout`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: "sessionIdToken=1:token",
        origin: "https://evil.example",
        "sec-fetch-site": "cross-site",
      },
      body: JSON.stringify({ planId: "pro" }),
    })

    expect([response.status, await code(response)]).toEqual([403, "REQUEST_ORIGIN_INVALID"])
    expect(recorder.checkouts).toEqual([])
  })
})
