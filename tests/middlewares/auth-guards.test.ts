import { expect } from "@std/expect"
import { describe, it } from "@std/testing/bdd"
import {
  createParseAuth,
  isAuthenticated1FA,
  isAuthenticated2FA,
  isRole,
} from "../../apps/api/middlewares/auth-guards.ts"
import { buildAuthData, stubContext } from "../helpers/fake-auth.ts"
import { SessionMFAStatus, UserMFAStatus, UserRole } from "../../libs/shared/types/+index.ts"

describe("auth-guards", () => {
  it("parseAuth stores auth payload", async () => {
    const authData = buildAuthData()
    const middleware = createParseAuth(async () => authData)
    const context = stubContext(null)
    let nextCalled = false

    await middleware(context, async () => {
      nextCalled = true
    })

    expect(nextCalled).toBe(true)
    expect(context.get("auth")).toEqual(authData)
  })

  it("isAuthenticated1FA rejects missing auth", async () => {
    const context = stubContext(null)
    const result = await isAuthenticated1FA(context, async () => undefined as never)
    expect(result).not.toBeUndefined()
    expect((result as Response).status).toBe(401)
  })

  it("isAuthenticated2FA rejects missing auth", async () => {
    const context = stubContext(null)
    const result = await isAuthenticated2FA(context, async () => undefined as never)
    expect(result).not.toBeUndefined()
    expect((result as Response).status).toBe(401)
  })

  it("isAuthenticated2FA rejects pending mfa", async () => {
    const authData = buildAuthData({
      user: { mfa: UserMFAStatus.CONFIGURED },
      session: { mfa: SessionMFAStatus.NOT_PASSED_YET },
    })
    const context = stubContext(authData)
    const result = await isAuthenticated2FA(context, async () => undefined as never)
    expect(result).not.toBeUndefined()
    expect((result as Response).status).toBe(401)
  })

  it("isAuthenticated2FA rejects configured mfa with not-required session", async () => {
    const authData = buildAuthData({
      user: { mfa: UserMFAStatus.CONFIGURED },
      session: { mfa: SessionMFAStatus.NOT_REQUIRED },
    })
    const context = stubContext(authData)
    const result = await isAuthenticated2FA(context, async () => undefined as never)
    expect(result).not.toBeUndefined()
    expect((result as Response).status).toBe(401)
  })

  it("isAuthenticated2FA accepts unconfigured mfa", async () => {
    const authData = buildAuthData({
      user: { mfa: UserMFAStatus.NOT_CONFIGURED },
      session: { mfa: SessionMFAStatus.NOT_REQUIRED },
    })
    const context = stubContext(authData)
    let nextCalled = false
    await isAuthenticated2FA(context, async () => {
      nextCalled = true
    })
    expect(nextCalled).toBe(true)
  })

  it("isRole blocks unauthorized role", async () => {
    const authData = buildAuthData({ user: { role: UserRole.VIEWER } })
    const context = stubContext(authData)
    const middleware = isRole(UserRole.ADMIN)
    const result = await middleware(context, async () => undefined as never)
    expect(result).not.toBeUndefined()
    expect((result as Response).status).toBe(403)
  })

  it("isRole allows role match", async () => {
    const authData = buildAuthData({ user: { role: UserRole.ADMIN } })
    const context = stubContext(authData)
    const middleware = isRole(UserRole.ADMIN)
    let nextCalled = false
    await middleware(context, async () => {
      nextCalled = true
    })
    expect(nextCalled).toBe(true)
  })
})
