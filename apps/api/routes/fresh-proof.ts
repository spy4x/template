import type { Context } from "hono"
import type { Lockout } from "@spy4x/server/lockout"
import { UserMFAStatus } from "@domain/identity"
import type { APIContext } from "../_types.ts"
import type { AppAuthState, SignIn } from "@api/services/sign-in.ts"

/** The answer when the account has two-factor on and the request carries no code. */
export const ACCOUNT_DELETE_CODE_REQUIRED = "Enter the code from your authenticator app"

/**
 * The answer when an account with no password asks for a step that the others confirm with their
 * password, and its session is no sign-in with Google or GitHub of a moment ago.
 */
export const PROVIDER_PROOF_REQUIRED =
  "Sign in with Google or GitHub again, then repeat this within a few minutes."

/** The answer to a wrong password in a fresh proof. */
export const FRESH_PROOF_PASSWORD_WRONG = "Invalid password"

/** The answer to a wrong authenticator code in a fresh proof. */
export const FRESH_PROOF_CODE_WRONG = "Code is incorrect"

/**
 * Runs one one-time-code check under the failure counter. While the user is locked the check does
 * not run at all, so not even a correct code gets through, and the answer is 429 with
 * `Retry-After`. A wrong code is recorded, a correct one gives its slot back.
 */
export async function checkUnderFailureCount(
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

/** What {@link checkFreshProof} calls. */
export interface FreshProofDependencies {
  signIn: Pick<SignIn, "hasPassword" | "checkPassword" | "confirmedByProvider" | "verifyTotpCode">
  totpFailures: Lockout
}

/**
 * Asks again for what a stolen session lacks before a step that cannot be taken back: the
 * password, and the authenticator code when two-factor is on, as the sign-in does. An account with
 * no password has signed in with Google or GitHub a moment ago instead (#384). Deleting one's
 * account and every operator action (#146) go through here, so there is one such step, not two.
 *
 * Answers `true` when the proof holds, or the refusal to send: 400 with the reason, or 429 while
 * the codes are locked.
 */
export async function checkFreshProof(
  c: Context<APIContext>,
  { signIn, totpFailures }: FreshProofDependencies,
  authData: AppAuthState,
  { password, otp }: { password?: string; otp?: string },
): Promise<Response | true> {
  const userId = authData.user.id
  if (await signIn.hasPassword(userId)) {
    if (password === undefined || !(await signIn.checkPassword(userId, password))) {
      return c.json({ error: FRESH_PROOF_PASSWORD_WRONG }, 400)
    }
  } else if (!(await signIn.confirmedByProvider(authData))) {
    return c.json({ error: PROVIDER_PROOF_REQUIRED }, 400)
  }
  if (authData.user.mfa !== UserMFAStatus.CONFIGURED) return true
  if (otp === undefined) return c.json({ error: ACCOUNT_DELETE_CODE_REQUIRED }, 400)
  return await checkUnderFailureCount(
    c,
    totpFailures,
    userId,
    () => signIn.verifyTotpCode(authData, otp),
    () => c.json({ error: FRESH_PROOF_CODE_WRONG }, 400),
  )
}
