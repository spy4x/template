import { Hono } from "hono"
import type { Context } from "hono"
import { validate } from "@spy4x/validation"
import { SecondFactorStatus } from "@spy4x/server/sign-in"
import { requestInfoFromContext } from "@spy4x/platform/request-info"
import {
  authOTPSchema,
  authPasswordChangeSchema,
  authUsernamePasswordSchema,
  type User,
} from "@domain/identity"
import type { SignIn } from "@api/services/sign-in.ts"
import { UserSignedInEvent, UserSignedOutEvent, UserSignedUpEvent } from "@api/cqrs/events.ts"
import { APIContext } from "../_types.ts"
import type { MutationGuards } from "../middlewares/mutation-guards.ts"
import type { TotpFailures } from "../services/totp-failures.ts"
import type { AuthRateLimits } from "../middlewares/auth-rate-limits.ts"
import { readApiJson } from "@api/services/json-body.ts"

/** What the auth routes call. `index.ts` passes the app's singletons; tests pass fakes. */
export interface AuthRouteDependencies {
  signIn: SignIn
  emit(event: UserSignedInEvent | UserSignedOutEvent | UserSignedUpEvent): void
  mutationGuards: MutationGuards
  rateLimits: AuthRateLimits
  /** Persistent count of wrong one-time codes per user, with a growing lock. */
  totpFailures: TotpFailures
}

/**
 * Runs one one-time-code check under the failure counter. While the user is locked the check does
 * not run at all, so not even a correct code gets through, and the answer is 429 with
 * `Retry-After`. A correct code gives its slot back.
 */
async function checkUnderFailureCount(
  c: Context<APIContext>,
  totpFailures: TotpFailures,
  userId: number,
  check: () => Promise<boolean>,
  wrongAnswer: () => Response,
): Promise<Response | true> {
  const waitMs = await totpFailures.begin(userId)
  if (waitMs > 0) {
    c.header("Retry-After", String(Math.ceil(waitMs / 1000)))
    return c.json({ error: "Too many wrong codes, try again later." }, 429)
  }
  if (!(await check())) return wrongAnswer()
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
  { signIn, emit, mutationGuards, rateLimits, totpFailures }: AuthRouteDependencies,
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
      return signInAnswer(c, signedIn)
    })
    .post(`/password/sign-up`, mutationGuards.anonymous, rateLimits.strictByIp, async (c) => {
      const body = await readApiJson(c)
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
      return signInAnswer(c, signedUp)
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
