import { expect } from "@std/expect"
import { describe, it } from "@std/testing/bdd"
import type { APIContext } from "../_types.ts"
import type { SignedIn, SignIn } from "../services/sign-in.ts"
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
import { createAuthRoute } from "./auth.ts"

/** A sign-in whose operations only record that the route called them. */
function fakeSignIn(calls: string[]): SignIn {
  const signedIn = (): Promise<SignedIn> => {
    const { user, session } = buildAuthData()
    return Promise.resolve({ user, session })
  }
  return {
    auth: testSessionGuards(),
    signUp: () => (calls.push("signUp"), signedIn()),
    signIn: () => (calls.push("signIn"), signedIn()),
    signOut: () => (calls.push("signOut"), Promise.resolve()),
    connectTotpStart: () => (
      calls.push("connectTotpStart"), Promise.resolve({ error: null, qrcode: "qr", secret: "s" })
    ),
    connectTotpFinish: () => (calls.push("connectTotpFinish"), Promise.resolve(true)),
    checkTotp: () => (calls.push("checkTotp"), Promise.resolve(true)),
    disconnectTotp: () => (calls.push("disconnectTotp"), Promise.resolve(true)),
    changePassword: () => (calls.push("changePassword"), Promise.resolve(true)),
    expireSessions: () => Promise.resolve(),
  }
}

function buildApp(auth: APIContext["Variables"]["auth"] = buildAuthData()) {
  const calls: string[] = []
  const route = createAuthRoute({
    signIn: fakeSignIn(calls),
    emit: () => {},
    mutationGuards: testMutationGuards,
  })
  return { app: mountRoute("/auth", route, auth), calls }
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
