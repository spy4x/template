import { Hono } from "hono"
import { validate } from "@spy4x/validation"
import { SecondFactorStatus } from "@spy4x/server/sign-in"
import { requestInfoFromContext } from "@spy4x/platform/request-info"
import {
  authOTPSchema,
  authPasswordChangeSchema,
  authUsernamePasswordSchema,
} from "@domain/identity"
import type { SignIn } from "@api/services/sign-in.ts"
import { UserSignedInEvent, UserSignedOutEvent, UserSignedUpEvent } from "@api/cqrs/events.ts"
import { APIContext } from "../_types.ts"
import type { MutationGuards } from "../middlewares/mutation-guards.ts"

/** What the auth routes call. `index.ts` passes the app's singletons; tests pass fakes. */
export interface AuthRouteDependencies {
  signIn: SignIn
  emit(event: UserSignedInEvent | UserSignedOutEvent | UserSignedUpEvent): void
  mutationGuards: MutationGuards
}

export function createAuthRoute(
  { signIn, emit, mutationGuards }: AuthRouteDependencies,
): Hono<APIContext> {
  const { isAuthenticated1FA, isAuthenticated2FA } = signIn.auth
  return new Hono<APIContext>()
    .post(`/sign-out`, mutationGuards.anonymous, async (c) => {
      const authData = c.get("auth")
      await signIn.signOut(c)
      if (authData) {
        emit(
          new UserSignedOutEvent({
            userId: authData.user.id,
            // trustedProxy: true keeps the old behaviour of trusting X-Forwarded-For / X-Real-IP.
            request: requestInfoFromContext(c, { trustedProxy: true }),
          }),
        )
      }
      return c.json({ success: true })
    })
    // .use(strictRateLimiter)
    .get(`/me`, async (c) => {
      const authData = c.get("auth")
      if (!authData) {
        return c.json({ error: "User not signed in" }, 401)
      }
      return c.json(authData.user)
    })
    .post(`password/check`, mutationGuards.anonymous, async (c) => {
      const body = await c.req.json()
      const validationResult = validate(authUsernamePasswordSchema, body)
      if (validationResult.error) {
        return c.json({ error: validationResult.error.description }, 400)
      }
      const { username, password } = validationResult.data
      const signedIn = await signIn.signIn(c, username, password)
      if (!signedIn) {
        return c.json({ error: "Invalid username or password" }, 401)
      }
      emit(
        new UserSignedInEvent({
          user: signedIn.user,
          // trustedProxy: true keeps the old behaviour of trusting X-Forwarded-For / X-Real-IP.
          request: requestInfoFromContext(c, { trustedProxy: true }),
        }),
      )
      return c.json(
        signedIn.user,
        signedIn.session.secondFactor === SecondFactorStatus.Pending ? 202 : 200,
      )
    })
    .post(`/password/sign-up`, mutationGuards.anonymous, async (c) => {
      const body = await c.req.json()
      const validationResult = validate(authUsernamePasswordSchema, body)
      if (validationResult.error) {
        return c.json({ error: validationResult.error.description }, 400)
      }
      const { username, password } = validationResult.data
      const signedUp = await signIn.signUp(c, username, password)
      if (!signedUp) {
        return c.json({ error: "Invalid username or password" }, 401)
      }
      emit(
        new UserSignedUpEvent({
          user: signedUp.user,
          username,
          // trustedProxy: true keeps the old behaviour of trusting X-Forwarded-For / X-Real-IP.
          request: requestInfoFromContext(c, { trustedProxy: true }),
        }),
      )
      return c.json(
        signedUp.user,
        signedUp.session.secondFactor === SecondFactorStatus.Pending ? 202 : 200,
      )
    })
    .use(isAuthenticated1FA)
    .use(mutationGuards.signedIn)
    .post(`/totp/check`, async (c) => {
      const authData = c.get("auth")
      if (!authData) {
        return c.json({ error: "User not signed in" }, 401)
      }
      try {
        const body = await c.req.json()
        const validationResult = validate(authOTPSchema, body)
        if (validationResult.error) {
          return c.json({ error: validationResult.error.description }, 400)
        }
        const isSuccess = await signIn.checkTotp(authData, validationResult.data.otp)
        if (!isSuccess) {
          return c.json({ error: "Invalid token" }, 401)
        }
        return c.json(authData.user)
      } catch (_error) {
        return c.json({ error: "Invalid request format" }, 400)
      }
    })
    .post(`/totp/connect/start`, async (c) => {
      const { error, qrcode, secret } = await signIn.connectTotpStart(c.get("auth")!)
      if (error) {
        return c.json({ error }, 400)
      }
      return c.json({ qrcode, secret })
    })
    .post(`/totp/connect/finish`, async (c) => {
      const body = await c.req.json()
      const validationResult = validate(authOTPSchema, body)
      if (validationResult.error) {
        return c.json({ error: validationResult.error.description }, 400)
      }
      const isSuccess = await signIn.connectTotpFinish(c.get("auth")!, validationResult.data.otp)
      if (!isSuccess) {
        return c.json({ error: "Code is incorrect" }, 400)
      }
      return c.json({ success: true })
    })
    // .use(rateLimiter)
    .use(isAuthenticated2FA)
    .post(`/totp/disconnect`, async (c) => {
      const isSuccess = await signIn.disconnectTotp(c.get("auth")!)
      if (!isSuccess) {
        return c.json({ error: "OTP already disabled for your account" }, 400)
      }
      return c.json({ success: true })
    })
    .post(`/password/change`, async (c) => {
      const body = await c.req.json()
      const validationResult = validate(authPasswordChangeSchema, body)
      if (validationResult.error) {
        return c.json({ error: validationResult.error.description }, 400)
      }
      const { password, newPassword } = validationResult.data
      const isSuccess = await signIn.changePassword(c, c.get("auth")!, password, newPassword)
      if (!isSuccess) {
        return c.json({ error: "Invalid password" }, 400)
      }
      return c.json({ success: true })
    })
}
