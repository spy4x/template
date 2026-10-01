import { Hono } from "hono"
import type { Context } from "hono"
import { validate } from "@spy4x/validation"
import { SecondFactorStatus } from "@spy4x/server/sign-in"
import { requestInfoFromContext } from "@spy4x/platform/request-info"
import { normalizeEmail } from "@spy4x/server/auth"
import {
  authOTPSchema,
  authPasswordChangeSchema,
  authPasswordForgotSchema,
  authPasswordResetSchema,
  authSignInSchema,
  authSignUpSchema,
  type User,
} from "@domain/identity"
import type { SignIn } from "@api/services/sign-in.ts"
import { UserSignedInEvent, UserSignedOutEvent, UserSignedUpEvent } from "@api/cqrs/events.ts"
import { APIContext } from "../_types.ts"
import type { MutationGuards } from "../middlewares/mutation-guards.ts"
import type { Lockout } from "@spy4x/server/lockout"
import type { AuthRateLimits } from "../middlewares/auth-rate-limits.ts"
import { readApiJson } from "@api/services/json-body.ts"

/** What the auth routes call. `index.ts` passes the app's singletons; tests pass fakes. */
export interface AuthRouteDependencies {
  signIn: SignIn
  emit(event: UserSignedInEvent | UserSignedOutEvent | UserSignedUpEvent): void
  mutationGuards: MutationGuards
  rateLimits: AuthRateLimits
  /** Persistent count of wrong one-time codes per user, with a growing lock. */
  totpFailures: Lockout
  /**
   * Queues a reset link for a normalised address. The worker sends it only when an account signs
   * in with the address, so this call does the same work either way.
   */
  requestPasswordReset(email: string): Promise<void>
}

/** The answer to a reset request that was accepted, whether or not the address has an account. */
export const PASSWORD_RESET_REQUESTED = {
  success: true,
  message: "If an account uses this address, a link to reset its password is on its way.",
}

/** The answer to a reset link that cannot be used. */
export const PASSWORD_RESET_REFUSED = "This link is invalid, used or expired. Ask for a new one."

/**
 * Runs one one-time-code check under the failure counter. While the user is locked the check does
 * not run at all, so not even a correct code gets through, and the answer is 429 with
 * `Retry-After`. A wrong code is recorded, a correct one gives its slot back.
 */
async function checkUnderFailureCount(
  c: Context<APIContext>,
  totpFailures: Lockout,
  userId: number,
  check: () => Promise<boolean>,
  wrongAnswer: () => Response,
): Promise<Response | true> {
  const waitMs = await totpFailures.begin(userId)
  if (waitMs > 0) {
    c.header("Retry-After", String(Math.ceil(waitMs / 1000)))
    return c.json({ error: "Too many wrong codes, try again later." }, 429)
  }
  if (!(await check())) {
    await totpFailures.fail(userId)
    return wrongAnswer()
  }
  await totpFailures.refund(userId)
  return true
}

/**
 * The body of a sign-in answer. A session that still owes its one-time code gets 202 and only
 * `{ secondFactor: "Pending" }`: the profile stays behind the second factor, like `/users/me`.
 */
function signInAnswer(
  c: Context<APIContext>,
  { user, session }: { user: User; session: { secondFactor: SecondFactorStatus } },
) {
  if (session.secondFactor === SecondFactorStatus.Pending) {
    return c.json({ secondFactor: "Pending" }, 202)
  }
  return c.json(user, 200)
}

export function createAuthRoute(
  { signIn, emit, mutationGuards, rateLimits, totpFailures, requestPasswordReset }:
    AuthRouteDependencies,
): Hono<APIContext> {
  const { isAuthenticated1FA, isAuthenticated2FA } = signIn.auth
  return new Hono<APIContext>()
    .post(`/sign-out`, mutationGuards.anonymous, rateLimits.normal, async (c) => {
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
    .get(`/me`, rateLimits.normal, async (c) => {
      const authData = c.get("auth")
      if (!authData) {
        return c.json({ error: "User not signed in" }, 401)
      }
      // 202, like `password/check`: the session still owes its second factor. A reloaded page
      // learns that here, since it has no memory of the sign-in response.
      return signInAnswer(c, authData)
    })
    .post(`password/check`, mutationGuards.anonymous, rateLimits.strictByIp, async (c) => {
      const body = await readApiJson(c)
      const validationResult = validate(authSignInSchema, body)
      if (validationResult.error) {
        return c.json({ error: validationResult.error.description }, 400)
      }
      const { login, password } = validationResult.data
      const signedIn = await signIn.signIn(c, login, password)
      if (!signedIn) {
        return c.json({ error: "Invalid e-mail, username or password" }, 401)
      }
      emit(
        new UserSignedInEvent({
          user: signedIn.user,
          // trustedProxy: true keeps the old behaviour of trusting X-Forwarded-For / X-Real-IP.
          request: requestInfoFromContext(c, { trustedProxy: true }),
        }),
      )
      return signInAnswer(c, signedIn)
    })
    .post(`/password/sign-up`, mutationGuards.anonymous, rateLimits.strictByIp, async (c) => {
      const body = await readApiJson(c)
      const validationResult = validate(authSignUpSchema, body)
      if (validationResult.error) {
        return c.json({ error: validationResult.error.description }, 400)
      }
      const email = normalizeEmail(validationResult.data.email)
      if (email === null) {
        return c.json({ error: "Enter a valid e-mail address" }, 400)
      }
      const signedUp = await signIn.signUp(c, email, validationResult.data.password)
      if (!signedUp) {
        // Sign-up necessarily tells that an address is taken; "Forgot password" is the way in.
        return c.json({ error: "This e-mail address cannot be used to sign up" }, 401)
      }
      emit(
        new UserSignedUpEvent({
          user: signedUp.user,
          email,
          // trustedProxy: true keeps the old behaviour of trusting X-Forwarded-For / X-Real-IP.
          request: requestInfoFromContext(c, { trustedProxy: true }),
        }),
      )
      return signInAnswer(c, signedUp)
    })
    .post(`/password/forgot`, mutationGuards.anonymous, rateLimits.strictByIp, async (c) => {
      const body = await readApiJson(c)
      const validationResult = validate(authPasswordForgotSchema, body)
      if (validationResult.error) {
        return c.json({ error: validationResult.error.description }, 400)
      }
      const email = normalizeEmail(validationResult.data.email)
      if (email === null) {
        return c.json({ error: "Enter a valid e-mail address" }, 400)
      }
      // Spent for every address, known or not, so a refusal tells nothing about an account.
      const decision = await rateLimits.resetByAddress(email)
      if (!decision.allowed) {
        c.header("Retry-After", String(Math.ceil(decision.retryAfterMs / 1000)))
        return c.json({ error: "Too many reset links for this address, try again later." }, 429)
      }
      await requestPasswordReset(email)
      return c.json(PASSWORD_RESET_REQUESTED)
    })
    .post(`/password/reset`, mutationGuards.anonymous, rateLimits.strictByIp, async (c) => {
      const body = await readApiJson(c)
      const validationResult = validate(authPasswordResetSchema, body)
      if (validationResult.error) {
        return c.json({ error: validationResult.error.description }, 400)
      }
      const { email, code, newPassword } = validationResult.data
      if (!(await signIn.resetPassword(email, code, newPassword))) {
        return c.json({ error: PASSWORD_RESET_REFUSED }, 400)
      }
      return c.json({ success: true })
    })
    .use(isAuthenticated1FA)
    .use(mutationGuards.signedIn)
    .post(`/totp/check`, rateLimits.otpByUser, async (c) => {
      const authData = c.get("auth")
      if (!authData) {
        return c.json({ error: "User not signed in" }, 401)
      }
      const body = await readApiJson(c)
      try {
        const validationResult = validate(authOTPSchema, body)
        if (validationResult.error) {
          return c.json({ error: validationResult.error.description }, 400)
        }
        const outcome = await checkUnderFailureCount(
          c,
          totpFailures,
          authData.user.id,
          () => signIn.checkTotp(authData, validationResult.data.otp),
          () => c.json({ error: "Invalid token" }, 401),
        )
        return outcome === true ? c.json(authData.user) : outcome
      } catch (_error) {
        return c.json({ error: "Invalid request format" }, 400)
      }
    })
    .post(`/totp/connect/start`, rateLimits.normal, async (c) => {
      const { error, qrcode, secret } = await signIn.connectTotpStart(c.get("auth")!)
      if (error) {
        return c.json({ error }, 400)
      }
      return c.json({ qrcode, secret })
    })
    .post(`/totp/connect/finish`, rateLimits.otpByUser, async (c) => {
      const body = await readApiJson(c)
      const validationResult = validate(authOTPSchema, body)
      if (validationResult.error) {
        return c.json({ error: validationResult.error.description }, 400)
      }
      const authData = c.get("auth")!
      const outcome = await checkUnderFailureCount(
        c,
        totpFailures,
        authData.user.id,
        () => signIn.connectTotpFinish(authData, validationResult.data.otp),
        () => c.json({ error: "Code is incorrect" }, 400),
      )
      return outcome === true ? c.json({ success: true }) : outcome
    })
    .use(isAuthenticated2FA)
    .post(`/totp/disconnect`, rateLimits.normal, async (c) => {
      const isSuccess = await signIn.disconnectTotp(c.get("auth")!)
      if (!isSuccess) {
        return c.json({ error: "OTP already disabled for your account" }, 400)
      }
      return c.json({ success: true })
    })
    .post(`/password/change`, rateLimits.strictByUser, async (c) => {
      const body = await readApiJson(c)
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
