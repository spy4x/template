import { useState } from "preact/hooks"
import { Link, useLocation } from "wouter-preact"
import { type AuthCredentials, AuthForm, type AuthMode } from "@spy4x/preact-system/auth-form"
import { Card, CardBody, CardHeader } from "@spy4x/preact-ui/card"
import { checkTotp, signIn, signUp } from "../state/auth.ts"
import { sessionState } from "../state/session.ts"

/** The three screens `AuthView` draws: the two credential modes, and the second factor. */
export type AuthScreen = AuthMode | "one-time-code"

const PATHS: Record<AuthScreen, string> = {
  "sign-in": "/sign-in",
  "sign-up": "/sign-up",
  "one-time-code": "/totp",
}

const COPY: Record<AuthScreen, { title: string; description: string; failure: string }> = {
  "sign-in": {
    title: "Welcome back",
    description: "Sign in to manage your profile and push devices.",
    failure: "Sign in failed",
  },
  "sign-up": {
    title: "Create account",
    description: "Start with a username and password.",
    failure: "Sign up failed",
  },
  "one-time-code": {
    title: "2FA verification",
    description: "Enter the 6-digit code from your authenticator app.",
    failure: "Invalid token",
  },
}

/**
 * Sign-in, sign-up and the second-factor step: one `AuthForm` from `@spy4x/preact-system`, wired
 * to this app's `signIn`, `signUp` and `checkTotp`. The route picks `screen`; the form itself only
 * draws the fields and reports what was typed.
 */
export function AuthView({ screen }: { screen: AuthScreen }) {
  const [, navigate] = useLocation()
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const session = sessionState.value
  const copy = COPY[screen]

  /** Runs one attempt: a failure shows its message, a success reloads onto the next page. */
  const attempt = async (
    run: () => Promise<{ ok: boolean; error?: string; mfaRequired?: boolean }>,
  ) => {
    setError(null)
    setBusy(true)
    const result = await run()
    setBusy(false)
    if (!result.ok) {
      setError(result.error || copy.failure)
      return
    }
    location.href = result.mfaRequired ? PATHS["one-time-code"] : "/"
  }

  if (screen === "one-time-code" && !session.isMfaRequired) {
    return (
      <Card class="mx-auto w-full max-w-md">
        <CardHeader>
          <h1 class="text-lg font-semibold">MFA not required</h1>
        </CardHeader>
        <CardBody>
          <p class="mb-4">Continue to profile.</p>
          <Link href="/" class="link">Open profile</Link>
        </CardBody>
      </Card>
    )
  }

  if (screen !== "one-time-code" && session.user && !session.isMfaRequired) {
    return (
      <Card class="mx-auto w-full max-w-md">
        <CardHeader>
          <h1 class="text-lg font-semibold">Already signed in</h1>
        </CardHeader>
        <CardBody>
          <p class="mb-4">Go to your profile.</p>
          <Link href="/" class="link">Open profile</Link>
        </CardBody>
      </Card>
    )
  }

  return (
    <Card class="mx-auto w-full max-w-md">
      <CardHeader>
        <h1 class="text-lg font-semibold">{copy.title}</h1>
      </CardHeader>
      <CardBody>
        <p class="mb-4 text-sm">{copy.description}</p>
        <AuthForm
          mode={screen === "one-time-code" ? "sign-in" : screen}
          step={screen === "one-time-code" ? "one-time-code" : "credentials"}
          busy={busy}
          error={error}
          labels={{ login: "Username", codeHint: "Six digits from your authenticator app." }}
          onModeChange={(mode) => navigate(PATHS[mode])}
          onSignIn={({ login, password }: AuthCredentials) =>
            attempt(() => signIn(login, password))}
          onSignUp={({ login, password }: AuthCredentials) =>
            attempt(() => signUp(login, password))}
          onOneTimeCode={(code) => attempt(() => checkTotp(code))}
        />
        {screen === "one-time-code" && (
          <p class="mt-4 text-sm">
            Need help? <Link href="/sign-in" class="link">Back to sign in</Link>
          </p>
        )}
      </CardBody>
    </Card>
  )
}
