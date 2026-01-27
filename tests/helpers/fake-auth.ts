import type { APIContext } from "../../apps/api/_types.ts"
import type { AuthData } from "../../apps/api/services/auth/types.ts"
import { SessionMFAStatus, UserMFAStatus, UserRole, UserSessionStatus } from "../../libs/shared/types/+index.ts"

type AuthOverrides = {
  user?: Partial<AuthData["user"]>
  key?: Partial<AuthData["key"]>
  session?: Partial<AuthData["session"]>
}

export function buildAuthData(
  overrides: AuthOverrides = {},
): AuthData {
  const now = new Date("2026-01-26T08:00:00.000Z")
  return {
    user: {
      id: 1,
      firstName: "Test",
      lastName: "User",
      role: 1 as UserRole,
      mfa: 1 as UserMFAStatus,
      lastLoginAt: now,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
      ...overrides.user,
    },
    key: {
      id: 1,
      userId: 1,
      kind: 1,
      identification: "test-user",
      secret: "secret",
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
      ...overrides.key,
    },
    session: {
      id: 1,
      token: "token",
      userId: 1,
      keyId: 1,
      status: 1 as UserSessionStatus,
      mfa: 1 as SessionMFAStatus,
      expiresAt: new Date("2026-02-01T08:00:00.000Z"),
      createdAt: now,
      updatedAt: now,
      ...overrides.session,
    },
  }
}

export function stubContext(authData: AuthData | null) {
  const store = new Map<string, unknown>()
  store.set("auth", authData)
  const context = {
    get(key: keyof APIContext["Variables"]) {
      return store.get(key as string)
    },
    set(key: keyof APIContext["Variables"], value: unknown) {
      store.set(key as string, value)
    },
    json(body: unknown, status?: number) {
      return new Response(JSON.stringify(body), {
        status: status ?? 200,
        headers: { "content-type": "application/json" },
      })
    },
    req: {
      header() {
        return undefined
      },
    },
  }
  return context as unknown as import("hono").Context<APIContext>
}
