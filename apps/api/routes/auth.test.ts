import { expect } from "@std/expect"
import { describe, it } from "@std/testing/bdd"
import type { APIContext } from "../_types.ts"
import type { SignedIn, SignIn } from "../services/sign-in.ts"
import { SecondFactorStatus } from "@spy4x/server/sign-in"
import { buildAuthData } from "../_testing/fake-auth.ts"
import {
  API_URL,
  crossSiteHeaders,
  mountRoute,
  type MutationCase,
  sameOriginHeaders,
  sameOriginWithoutCookieHeaders,
  testMutationGuards,
  testSessionGuards,
} from "../_testing/mutation-requests.ts"
import { MALFORMED_JSON, oversizedJson } from "../_testing/json-bodies.ts"
import { type AuthRateLimits, createAuthRateLimits } from "../middlewares/auth-rate-limits.ts"
import type { Lockout } from "@spy4x/server/lockout"
import { createKvStore, type RateLimitStore } from "@spy4x/platform/rate-limit"
import { createAuthRoute } from "./auth.ts"

/**
 * A failure counter that records its calls in `calls`, and answers `lockedForMs` to `begin`
 * (0 = not locked).
 */
function fakeTotpFailures(calls: string[], lockedForMs = 0): Lockout {
  return {
    begin: () => (calls.push("begin"), Promise.resolve(lockedForMs)),
    refund: () => (calls.push("refund"), Promise.resolve()),
    fail: () => (calls.push("fail"), Promise.resolve()),
  }
}

/**
 * A sign-in whose operations only record that the route called them. With `succeed: false`, every
 * check of a password or a one-time code fails.
 */
function fakeSignIn(
  calls: string[],
  succeed = true,
  secondFactor = SecondFactorStatus.NotRequired,
): SignIn {
  const signedIn = (): Promise<SignedIn> => {
    const { user, session } = buildAuthData({ session: { secondFactor } })
    return Promise.resolve({ user, session })
  }
  return {
    auth: testSessionGuards(),
    signUp: () => (calls.push("signUp"), succeed ? signedIn() : Promise.resolve(null)),
    signIn: () => (calls.push("signIn"), succeed ? signedIn() : Promise.resolve(null)),
    signOut: () => (calls.push("signOut"), Promise.resolve()),
    connectTotpStart: () => (
      calls.push("connectTotpStart"), Promise.resolve({ error: null, qrcode: "qr", secret: "s" })
    ),
    connectTotpFinish: () => (calls.push("connectTotpFinish"), Promise.resolve(succeed)),
    checkTotp: () => (calls.push("checkTotp"), Promise.resolve(succeed)),
    disconnectTotp: () => (calls.push("disconnectTotp"), Promise.resolve(true)),
    changePassword: () => (calls.push("changePassword"), Promise.resolve(succeed)),
    expireSessions: () => Promise.resolve(),
    entitledSession: () => Promise.resolve(null),
  }
}

/** A new in-process store each call, standing in for one limiter's share of Valkey. */
function memoryStore(): RateLimitStore {
  const entries = new Map<string, unknown>()
  return createKvStore({
    backend: {
      get: (key) => Promise.resolve(entries.get(key)),
      set: (key, value) => Promise.resolve(void entries.set(key, value)),
      delete: (key) => Promise.resolve(void entries.delete(key)),
    },
  })
}

/** A store whose every call fails, as Valkey does while it is down. */
function brokenStore(): RateLimitStore {
  const down = () => Promise.reject(new Error("valkey is down"))
  return { read: down, write: down, delete: down, consume: down, release: down }
}

/** Limits no test outside the rate-limit block reaches. */
const generousLimits = {
  windowMs: 60_000,
  strictLimit: 1_000,
  limit: 1_000,
  otpWindowMs: 900_000,
  otpLimit: 1_000,
  store: memoryStore,
  onStoreError: () => {},
}

function buildApp(
  auth: APIContext["Variables"]["auth"] = buildAuthData(),
  { rateLimits = createAuthRateLimits(generousLimits), succeed = true, secondFactor, lockedForMs }:
    {
      rateLimits?: AuthRateLimits
      /** How long the failure counter says the user is locked; 0 or left out means not locked. */
      lockedForMs?: number
      succeed?: boolean
      /** The second-factor state of the session that `signIn` and `signUp` hand back. */
      secondFactor?: SecondFactorStatus
    } = {},
) {
  const calls: string[] = []
  const failureCalls: string[] = []
  const route = createAuthRoute({
    signIn: fakeSignIn(calls, succeed, secondFactor),
    emit: () => {},
    mutationGuards: testMutationGuards,
    rateLimits,
    totpFailures: fakeTotpFailures(failureCalls, lockedForMs),
  })
  return { app: mountRoute("/auth", route, auth), calls, failureCalls }
}

function send(
  app: ReturnType<typeof buildApp>["app"],
  { method, path, body }: MutationCase,
  headers: Readonly<Record<string, string>>,
) {
  return app.request(`${API_URL}${path}`, {
    method,
    headers: { ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
}

const credentials = { username: "alice", password: "correct-horse" }

/** Routes a browser without a session may call. */
const anonymousRoutes: (MutationCase & { operation: string })[] = [
  { method: "POST", path: "/auth/sign-out", body: undefined, operation: "signOut" },
  { method: "POST", path: "/auth/password/check", body: credentials, operation: "signIn" },
  { method: "POST", path: "/auth/password/sign-up", body: credentials, operation: "signUp" },
]

/** Routes behind `isAuthenticated1FA` or `isAuthenticated2FA`. */
const sessionRoutes: (MutationCase & { operation: string })[] = [
  { method: "POST", path: "/auth/totp/check", body: { otp: "123456" }, operation: "checkTotp" },
  {
    method: "POST",
    path: "/auth/totp/connect/start",
    body: undefined,
    operation: "connectTotpStart",
  },
  {
    method: "POST",
    path: "/auth/totp/connect/finish",
    body: { otp: "123456" },
    operation: "connectTotpFinish",
  },
  { method: "POST", path: "/auth/totp/disconnect", body: undefined, operation: "disconnectTotp" },
  {
    method: "POST",
    path: "/auth/password/change",
    body: { password: "correct-horse", newPassword: "battery-staple" },
    operation: "changePassword",
  },
]

describe("auth routes refuse cross-site requests", () => {
  for (const route of [...anonymousRoutes, ...sessionRoutes]) {
    it(`refuses a cross-site ${route.method} ${route.path} with 403`, async () => {
      const { app, calls } = buildApp()
      const response = await send(app, route, crossSiteHeaders)

      expect(response.status).toBe(403)
      expect(calls).toEqual([])
    })
  }
})

describe("auth routes a browser without a session may call", () => {
  for (const route of anonymousRoutes) {
    it(`accepts a same-origin ${route.method} ${route.path} through the TLS proxy without a cookie`, async () => {
      const { app, calls } = buildApp(null)
      const response = await send(app, route, sameOriginWithoutCookieHeaders)

      expect(response.ok).toBe(true)
      expect(calls).toEqual([route.operation])
    })
  }
})

describe("auth routes behind a session", () => {
  for (const route of sessionRoutes) {
    it(`accepts a same-origin ${route.method} ${route.path} through the TLS proxy`, async () => {
      const { app, calls } = buildApp()
      const response = await send(app, route, sameOriginHeaders)

      expect(response.ok).toBe(true)
      expect(calls).toEqual([route.operation])
    })

    it(`answers ${route.method} ${route.path} without a session with 401, not 403`, async () => {
      const { app, calls } = buildApp(null)
      const response = await send(app, route, sameOriginWithoutCookieHeaders)

      expect(response.status).toBe(401)
      expect(calls).toEqual([])
    })
  }
})

describe("auth routes cap the JSON body", () => {
  const bodyRoutes = [...anonymousRoutes, ...sessionRoutes].filter((route) => route.body)
  for (const route of bodyRoutes) {
    const headers = anonymousRoutes.includes(route)
      ? sameOriginWithoutCookieHeaders
      : sameOriginHeaders
    it(`answers an oversized body on ${route.method} ${route.path} with 413`, async () => {
      const { app, calls } = buildApp(anonymousRoutes.includes(route) ? null : undefined)
      const response = await app.request(`${API_URL}${route.path}`, {
        method: route.method,
        headers: { ...headers },
        body: oversizedJson(route.body),
      })

      expect(response.status).toBe(413)
      expect(calls).toEqual([])
    })

    it(`answers malformed JSON on ${route.method} ${route.path} with 400`, async () => {
      const { app, calls } = buildApp(anonymousRoutes.includes(route) ? null : undefined)
      const response = await app.request(`${API_URL}${route.path}`, {
        method: route.method,
        headers: { ...headers },
        body: MALFORMED_JSON,
      })

      expect(response.status).toBe(400)
      expect(calls).toEqual([])
    })
  }
})

describe("auth routes rate-limit", () => {
  /**
   * Three attempts per minute on the strict limit, two on the normal one, and the shipped five per
   * 15 minutes on the one-time-code limit.
   */
  const tightLimits = {
    windowMs: 60_000,
    strictLimit: 3,
    limit: 2,
    otpWindowMs: 900_000,
    otpLimit: 5,
    store: memoryStore,
    onStoreError: () => {},
  }

  const otpPaths = ["/auth/totp/check", "/auth/totp/connect/finish"]
  const strictByIpRoutes = anonymousRoutes.filter((route) => route.body)
  const otpRoutes = sessionRoutes.filter((route) => otpPaths.includes(route.path))
  const strictByUserRoutes = sessionRoutes.filter((route) =>
    route.body && !otpPaths.includes(route.path)
  )
  const normalRoutes = [
    ...anonymousRoutes.filter((route) => !route.body),
    ...sessionRoutes.filter((route) => !route.body),
  ]

  for (const route of strictByIpRoutes) {
    it(`answers the 4th failed ${route.path} from one IP with 429 and Retry-After`, async () => {
      const { app, calls } = buildApp(null, {
        rateLimits: createAuthRateLimits(tightLimits),
        succeed: false,
      })
      const headers = { ...sameOriginWithoutCookieHeaders, "x-real-ip": "192.0.2.1" }
      const responses = []
      for (let attempt = 0; attempt < 4; attempt++) {
        responses.push(await send(app, route, headers))
      }

      expect(responses.map((response) => response.status)).toEqual([401, 401, 401, 429])
      expect(Number(responses[3].headers.get("retry-after"))).toBeGreaterThan(0)
      expect(calls).toEqual([route.operation, route.operation, route.operation])
    })
  }

  it("gives another IP its own budget for password/check", async () => {
    const { app } = buildApp(null, {
      rateLimits: createAuthRateLimits(tightLimits),
      succeed: false,
    })
    const route = strictByIpRoutes[0]
    for (let attempt = 0; attempt < 4; attempt++) {
      await send(app, route, { ...sameOriginWithoutCookieHeaders, "x-real-ip": "192.0.2.1" })
    }
    const other = await send(app, route, {
      ...sameOriginWithoutCookieHeaders,
      "x-real-ip": "192.0.2.2",
    })

    expect(other.status).toBe(401)
  })

  it("keys password/check on X-Real-IP, not on a forged CF-Connecting-IP or X-Forwarded-For", async () => {
    const { app } = buildApp(null, {
      rateLimits: createAuthRateLimits(tightLimits),
      succeed: false,
    })
    const route = strictByIpRoutes[0]
    const statuses = []
    for (let attempt = 0; attempt < 4; attempt++) {
      const forged = `198.51.100.${attempt + 1}`
      const response = await send(app, route, {
        ...sameOriginWithoutCookieHeaders,
        "x-real-ip": "192.0.2.1",
        "cf-connecting-ip": forged,
        "x-forwarded-for": forged,
      })
      statuses.push(response.status)
    }

    expect(statuses).toEqual([401, 401, 401, 429])
  })

  for (const route of strictByUserRoutes) {
    it(`answers the 4th failed ${route.path} from one user with 429, whatever the IP`, async () => {
      const { app, calls } = buildApp(undefined, {
        rateLimits: createAuthRateLimits(tightLimits),
        succeed: false,
      })
      const statuses = []
      for (let attempt = 0; attempt < 4; attempt++) {
        const headers = { ...sameOriginHeaders, "x-real-ip": `192.0.2.${attempt + 1}` }
        statuses.push((await send(app, route, headers)).status)
      }

      expect(statuses.slice(3)).toEqual([429])
      expect(statuses.slice(0, 3)).not.toContain(429)
      expect(calls).toEqual([route.operation, route.operation, route.operation])
    })
  }

  for (const route of otpRoutes) {
    it(`answers the 6th failed ${route.path} in 15 minutes from one user with 429, whatever the IP`, async () => {
      const { app, calls } = buildApp(undefined, {
        rateLimits: createAuthRateLimits(tightLimits),
        succeed: false,
      })
      const statuses = []
      for (let attempt = 0; attempt < 6; attempt++) {
        const headers = { ...sameOriginHeaders, "x-real-ip": `192.0.2.${attempt + 1}` }
        statuses.push((await send(app, route, headers)).status)
      }

      expect(statuses.slice(5)).toEqual([429])
      expect(statuses.slice(0, 5)).not.toContain(429)
      expect(calls).toEqual(Array(5).fill(route.operation))
    })
  }

  for (const route of otpRoutes) {
    it(`lets six correct ${route.path} calls in 15 minutes all succeed`, async () => {
      const { app } = buildApp(undefined, {
        rateLimits: createAuthRateLimits(tightLimits),
        succeed: true,
      })
      const statuses = []
      for (let attempt = 0; attempt < 6; attempt++) {
        statuses.push((await send(app, route, sameOriginHeaders)).status)
      }

      expect(statuses).toEqual(Array(6).fill(200))
    })
  }

  it("still refuses the 6th wrong code after correct ones in between", async () => {
    let correct = true
    const calls: string[] = []
    const route = otpRoutes[0]
    const signIn = fakeSignIn(calls)
    signIn.checkTotp = () => Promise.resolve(correct)
    const app = mountRoute(
      "/auth",
      createAuthRoute({
        signIn,
        emit: () => {},
        mutationGuards: testMutationGuards,
        rateLimits: createAuthRateLimits(tightLimits),
        totpFailures: fakeTotpFailures([]),
      }),
      buildAuthData(),
    )
    const statuses = []
    for (const isCorrect of [false, false, true, false, true, false, false, false, false]) {
      correct = isCorrect
      statuses.push((await send(app, route, sameOriginHeaders)).status)
    }

    expect(statuses).toEqual([401, 401, 200, 401, 200, 401, 401, 429, 429])
  })

  it("counts totp/check and totp/connect/finish against one one-time-code budget", async () => {
    const { app, calls } = buildApp(undefined, {
      rateLimits: createAuthRateLimits(tightLimits),
      succeed: false,
    })
    const statuses = []
    for (let attempt = 0; attempt < 6; attempt++) {
      statuses.push((await send(app, otpRoutes[attempt % 2], sameOriginHeaders)).status)
    }

    expect(statuses.slice(5)).toEqual([429])
    expect(calls).toHaveLength(5)
  })

  it("keeps refusing one-time codes after the one-minute window, until 15 minutes pass", async () => {
    let now = 0
    const { app } = buildApp(undefined, {
      rateLimits: createAuthRateLimits({ ...tightLimits, clock: () => now }),
      succeed: false,
    })
    const route = otpRoutes[0]
    for (let attempt = 0; attempt < 5; attempt++) {
      await send(app, route, sameOriginHeaders)
    }
    now = 14 * 60_000
    const beforeWindowEnds = await send(app, route, sameOriginHeaders)
    now = 15 * 60_000 + 1
    const afterWindowEnds = await send(app, route, sameOriginHeaders)

    expect(beforeWindowEnds.status).toBe(429)
    expect(afterWindowEnds.status).toBe(401)
  })

  it("gives another user their own budget for totp/check", async () => {
    const rateLimits = createAuthRateLimits(tightLimits)
    const first = buildApp(buildAuthData({ user: { id: 1 } }), { rateLimits, succeed: false })
    const second = buildApp(buildAuthData({ user: { id: 2 } }), { rateLimits, succeed: false })
    const route = otpRoutes[0]
    for (let attempt = 0; attempt < 6; attempt++) {
      await send(first.app, route, sameOriginHeaders)
    }
    const other = await send(second.app, route, sameOriginHeaders)

    expect(other.status).toBe(401)
  })

  for (const route of normalRoutes) {
    it(`answers the 3rd ${route.method} ${route.path} in one window with 429`, async () => {
      const { app, calls } = buildApp(undefined, { rateLimits: createAuthRateLimits(tightLimits) })
      const statuses = []
      for (let attempt = 0; attempt < 3; attempt++) {
        statuses.push((await send(app, route, sameOriginHeaders)).status)
      }

      expect(statuses).toEqual([200, 200, 429])
      expect(calls).toEqual([route.operation, route.operation])
    })
  }

  for (const route of [...anonymousRoutes, ...sessionRoutes]) {
    it(`spends no budget on a refused cross-site ${route.method} ${route.path}`, async () => {
      const { app, calls } = buildApp(anonymousRoutes.includes(route) ? null : undefined, {
        rateLimits: createAuthRateLimits(tightLimits),
        succeed: false,
      })
      const headers = anonymousRoutes.includes(route)
        ? sameOriginWithoutCookieHeaders
        : sameOriginHeaders
      for (let attempt = 0; attempt < 6; attempt++) {
        await send(app, route, crossSiteHeaders)
      }
      const sameOrigin = await send(app, route, headers)

      expect(sameOrigin.status).not.toBe(429)
      expect(calls).toEqual([route.operation])
    })
  }

  it("answers GET /auth/me with 202 while the session owes its second factor", async () => {
    const { app } = buildApp(
      buildAuthData({ session: { secondFactor: SecondFactorStatus.Pending } }),
    )

    const response = await app.request(`${API_URL}/auth/me`, { headers: sameOriginHeaders })

    expect(response.status).toBe(202)
    expect(await response.json()).toEqual({ secondFactor: "Pending" })
  })

  it("answers POST /auth/password/check with 202 and no profile while the second factor is pending", async () => {
    const { app } = buildApp(undefined, { secondFactor: SecondFactorStatus.Pending })

    const response = await app.request(`${API_URL}/auth/password/check`, {
      method: "POST",
      headers: { ...sameOriginHeaders, "content-type": "application/json" },
      body: JSON.stringify(credentials),
    })

    expect(response.status).toBe(202)
    expect(await response.json()).toEqual({ secondFactor: "Pending" })
  })

  it("answers POST /auth/password/check with the user when no second factor is pending", async () => {
    const { app } = buildApp()

    const response = await app.request(`${API_URL}/auth/password/check`, {
      method: "POST",
      headers: { ...sameOriginHeaders, "content-type": "application/json" },
      body: JSON.stringify(credentials),
    })

    expect(response.status).toBe(200)
    expect((await response.json()).id).toBe(1)
  })

  for (
    const secondFactor of [SecondFactorStatus.NotRequired, SecondFactorStatus.Completed]
  ) {
    it(`answers GET /auth/me with 200 when the second factor is ${SecondFactorStatus[secondFactor]}`, async () => {
      const { app } = buildApp(buildAuthData({ session: { secondFactor } }))

      const response = await app.request(`${API_URL}/auth/me`, { headers: sameOriginHeaders })

      expect(response.status).toBe(200)
    })
  }

  it("answers GET /auth/me with 401 without a session", async () => {
    const { app } = buildApp(null)

    const response = await app.request(`${API_URL}/auth/me`, { headers: sameOriginHeaders })

    expect(response.status).toBe(401)
  })

  it("answers the 3rd GET /auth/me in one window with 429", async () => {
    const { app } = buildApp(undefined, { rateLimits: createAuthRateLimits(tightLimits) })
    const statuses = []
    for (let attempt = 0; attempt < 3; attempt++) {
      statuses.push(
        (await app.request(`${API_URL}/auth/me`, { headers: sameOriginHeaders })).status,
      )
    }

    expect(statuses).toEqual([200, 200, 429])
  })

  const guessingRoutes = [
    ...strictByIpRoutes.map((route) => ({
      route,
      auth: null,
      headers: sameOriginWithoutCookieHeaders,
    })),
    ...[...strictByUserRoutes, ...otpRoutes].map((route) => ({
      route,
      auth: undefined,
      headers: sameOriginHeaders,
    })),
  ]
  for (const { route, auth, headers } of guessingRoutes) {
    it(`refuses ${route.path} without calling ${route.operation} while its limit's store is down`, async () => {
      const { app, calls } = buildApp(auth, {
        rateLimits: createAuthRateLimits({ ...tightLimits, store: brokenStore }),
      })

      const response = await send(app, route, headers)

      expect(response.status).toBe(500)
      expect(calls).toEqual([])
    })
  }

  it("lets GET /auth/me through and reports the error while the normal limit's store is down", async () => {
    const errors: unknown[] = []
    const { app } = buildApp(undefined, {
      rateLimits: createAuthRateLimits({
        ...tightLimits,
        store: brokenStore,
        onStoreError: (error) => errors.push(error),
      }),
    })

    const response = await app.request(`${API_URL}/auth/me`, { headers: sameOriginHeaders })

    expect(response.status).toBe(200)
    expect(errors.map((error) => (error as Error).message)).toEqual(["valkey is down"])
  })
})

describe("auth routes count wrong one-time codes per user", () => {
  const otpRoutes = sessionRoutes.filter((route) =>
    ["/auth/totp/check", "/auth/totp/connect/finish"].includes(route.path)
  )

  for (const route of otpRoutes) {
    it(`answers ${route.path} with 429 and Retry-After while the user is locked, without checking the code`, async () => {
      const { app, calls, failureCalls } = buildApp(undefined, { lockedForMs: 90_500 })
      const response = await send(app, route, sameOriginHeaders)

      expect(response.status).toBe(429)
      expect(response.headers.get("retry-after")).toBe("91")
      expect(failureCalls).toEqual(["begin"])
      expect(calls).toEqual([])
    })

    it(`counts the check before running it and gives the slot back after a correct ${route.path}`, async () => {
      const { app, calls, failureCalls } = buildApp(undefined, { succeed: true })
      const response = await send(app, route, sameOriginHeaders)

      expect(response.status).toBe(200)
      expect(failureCalls).toEqual(["begin", "refund"])
      expect(calls).toEqual([route.operation])
    })

    it(`records a wrong ${route.path}`, async () => {
      const { app, calls, failureCalls } = buildApp(undefined, { succeed: false })
      await send(app, route, sameOriginHeaders)

      expect(failureCalls).toEqual(["begin", "fail"])
      expect(calls).toEqual([route.operation])
    })
  }
})
