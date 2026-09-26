import { expect } from "@std/expect"
import { describe, it } from "@std/testing/bdd"
import type { APIContext } from "../_types.ts"
import { buildAuthData } from "../_testing/fake-auth.ts"
import {
  API_URL,
  crossSiteHeaders,
  mountRoute,
  sameOriginHeaders,
  sameOriginWithoutCookieHeaders,
  testMutationGuards,
  testSessionGuards,
} from "../_testing/mutation-requests.ts"
import { createUsersRoute } from "./users.ts"

function buildApp(auth: APIContext["Variables"]["auth"] = buildAuthData()) {
  const calls: string[] = []
  const route = createUsersRoute({
    auth: testSessionGuards(),
    mutationGuards: testMutationGuards,
    getProfile: () => (calls.push("getProfile"), Promise.resolve({ user: buildAuthData().user })),
    updateProfile: () => (
      calls.push("updateProfile"), Promise.resolve({ user: buildAuthData().user })
    ),
  })
  return { app: mountRoute("/users", route, auth), calls }
}

function patchProfile(
  app: ReturnType<typeof buildApp>["app"],
  headers: Readonly<Record<string, string>>,
) {
  return app.request(`${API_URL}/users/me`, {
    method: "PATCH",
    headers: { ...headers },
    body: JSON.stringify({ firstName: "Ada", lastName: "Lovelace" }),
  })
}

describe("users routes", () => {
  it("refuses a cross-site PATCH /users/me with 403", async () => {
    const { app, calls } = buildApp()
    const response = await patchProfile(app, crossSiteHeaders)

    expect(response.status).toBe(403)
    expect(calls).toEqual([])
  })

  it("accepts a same-origin PATCH /users/me through the TLS proxy", async () => {
    const { app, calls } = buildApp()
    const response = await patchProfile(app, sameOriginHeaders)

    expect(response.status).toBe(200)
    expect(calls).toEqual(["updateProfile"])
  })

  it("answers PATCH /users/me without a session with 401, not 403", async () => {
    const { app, calls } = buildApp(null)
    const response = await patchProfile(app, sameOriginWithoutCookieHeaders)

    expect(response.status).toBe(401)
    expect(calls).toEqual([])
  })
})
