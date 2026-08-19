import { Context } from "hono"
import { CookieManager } from "./cookie.ts"
import { AuthData } from "./types.ts"
import { SessionManager } from "./session.ts"
import { PasswordMethod } from "./password.ts"
import { db } from "../db.ts"
import { TOTPMethod } from "./totp.ts"
import { APIContext } from "../../_types.ts"
import { UserMFAStatus } from "@domain/identity"
import { eventBus } from "@api/services/eventBus.ts"
import { UserSignedInEvent, UserSignedOutEvent, UserSignedUpEvent } from "@api/cqrs/events.ts"
import { requestInfoFromContext } from "@api/services/request-info.ts"
import { GroupError } from "@domain/groups"

class Auth {
  private cookie = new CookieManager()
  private session = new SessionManager()
  private totp = new TOTPMethod(this.session)
  private usernamePassword = new PasswordMethod(this.session)

  async getForRequest(context: Context<APIContext>): Promise<null | AuthData> {
    const sessionIdToken = await this.cookie.getSessionIdToken(context)
    if (!sessionIdToken) {
      return null
    }

    const result = await this.session.validate(sessionIdToken)
    if (!result) {
      this.cookie.invalidate(context)
      return null
    }

    const { session, user } = result
    const key = await db.userKey.findById(session.keyId)

    if (!user || user.deletedAt || !key) {
      this.cookie.invalidate(context)
      return null
    }
    try {
      await db.group.ensurePersonal({ id: crypto.randomUUID(), name: "Personal" }, user.id)
    } catch (error) {
      if (error instanceof GroupError && error.code === "USER_NOT_ACTIVE") {
        this.cookie.invalidate(context)
        return null
      }
      throw error
    }
    return { user, key, session }
  }

  async signInWithPassword(
    username: string,
    password: string,
    context: Context<APIContext>,
  ): Promise<null | AuthData> {
    const authData = await this.usernamePassword.check(username, password)
    if (!authData) return null
    if (authData.user.deletedAt) {
      return null
    }
    await this.cookie.set(
      context,
      authData.user.id,
      this.session.getIdTokenForCookie(authData.session),
    )
    authData.user = await db.user.updateOne({
      id: authData.user.id,
      data: { lastLoginAt: new Date() },
    })
    eventBus.emit(
      new UserSignedInEvent({
        user: authData.user,
        request: requestInfoFromContext(context),
      }),
    )
    return authData
  }

  async signUpWithPassword(
    username: string,
    password: string,
    context: Context<APIContext>,
  ): Promise<null | AuthData> {
    const authData = await this.usernamePassword.signUp(username, password)
    if (!authData) return null
    if (authData.user.deletedAt) {
      return null
    }
    await this.cookie.set(
      context,
      authData.user.id,
      this.session.getIdTokenForCookie(authData.session),
    )

    eventBus.emit(
      new UserSignedUpEvent({
        user: authData.user,
        username,
        request: requestInfoFromContext(context),
      }),
    )

    return authData
  }

  async connectTOTPStart(
    authData: AuthData,
  ): Promise<
    {
      error: string
      qrcode: null
      secret: null
    } | {
      error: null
      qrcode: string
      secret: string
    }
  > {
    if (authData.user.mfa === UserMFAStatus.CONFIGURED) {
      return { error: "OTP already activated for your account", qrcode: null, secret: null }
    }
    return this.totp.connectStart(authData)
  }

  async disconnectTOTP(authData: AuthData): Promise<boolean> {
    if (authData.user.mfa === UserMFAStatus.NOT_CONFIGURED) {
      return false
    }
    return this.totp.disconnect(authData)
  }

  async connectTOTPFinish(authData: AuthData, otp: string): Promise<boolean> {
    return this.totp.connectFinish(
      authData,
      otp,
    )
  }

  async checkTOTP(authData: AuthData, otp: string): Promise<boolean> {
    return this.totp.check(
      authData,
      otp,
    )
  }

  async signOut(context: Context<APIContext>): Promise<void> {
    const sessionIdToken = await this.cookie.getSessionIdToken(context)
    this.cookie.invalidate(context)
    if (sessionIdToken) {
      await auth.session.delete(sessionIdToken)
    }
    const authData = context.get("auth")
    if (authData) {
      eventBus.emit(
        new UserSignedOutEvent({
          userId: authData.user.id,
          request: requestInfoFromContext(context),
        }),
      )
    }
  }

  async expireSessions() {
    await auth.session.deleteExpired()
  }

  async invalidateUser(userId: number): Promise<void> {
    await this.session.signOutByUser(userId)
    await db.userPushToken.deleteByUser({ userId })
  }

  async changePassword(
    oldPassword: string,
    newPassword: string,
    context: Context<APIContext>,
  ): Promise<boolean> {
    const authData = context.get("auth")
    const newSession = await this.usernamePassword.change(
      authData,
      oldPassword,
      newPassword,
    )
    if (!newSession) {
      return false
    }
    await this.cookie.set(
      context,
      authData.user.id,
      this.session.getIdTokenForCookie(newSession),
    )
    return true
  }

  setPassword(
    userId: number,
    password: string,
    username: string,
  ): Promise<boolean> {
    return this.usernamePassword.set(userId, password, username)
  }
}

export const auth = new Auth()
