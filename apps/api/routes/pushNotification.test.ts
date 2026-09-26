import { expect } from "@std/expect"
import { describe, it } from "@std/testing/bdd"
import type { APIContext } from "../_types.ts"
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
import { createPushNotificationRoute } from "./pushNotification.ts"

function buildApp(auth: APIContext["Variables"]["auth"] = buildAuthData()) {
  const calls: string[] = []
  const route = createPushNotificationRoute({
    auth: testSessionGuards(),
    mutationGuards: testMutationGuards,
    emit: () => {},
    webPush: {
      getPublicKey: () => "public-key",
      deviceList: () => Promise.resolve([]),
      subscribe: (_subscription, deviceId, userId) => {
        calls.push("subscribe")
        const now = new Date("2026-09-26T10:00:00.000Z")
        return Promise.resolve({ id: 1, userId, deviceId, createdAt: now, updatedAt: now })
      },
      unsubscribe: () => (calls.push("unsubscribe"), Promise.resolve()),
    },
  })
  return { app: mountRoute("/push", route, auth), calls }
}

function send(
  app: ReturnType<typeof buildApp>["app"],
  { method, path, body }: MutationCase,
  headers: Readonly<Record<string, string>>,
) {
  return app.request(`${API_URL}${path}`, {
    method,
    headers: { ...headers },
    body: JSON.stringify(body),
  })
}

const routes: (MutationCase & { operation: string })[] = [
  {
    method: "POST",
    path: "/push",
    body: {
      deviceId: "device-1",
      subscription: {
        endpoint: "https://push.example/endpoint",
        keys: { auth: "auth-key", p256dh: "p256dh-key" },
      },
    },
    operation: "subscribe",
  },
  { method: "DELETE", path: "/push", body: { deviceId: "device-1" }, operation: "unsubscribe" },
]

describe("push routes", () => {
  for (const route of routes) {
    it(`refuses a cross-site ${route.method} ${route.path} with 403`, async () => {
      const { app, calls } = buildApp()
      const response = await send(app, route, crossSiteHeaders)

      expect(response.status).toBe(403)
      expect(calls).toEqual([])
    })

    it(`accepts a same-origin ${route.method} ${route.path} through the TLS proxy`, async () => {
      const { app, calls } = buildApp()
      const response = await send(app, route, sameOriginHeaders)

      expect(response.status).toBe(200)
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
