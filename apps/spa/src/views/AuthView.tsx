import { useState } from "preact/hooks"
import { useLocation } from "wouter-preact"
import type { AuthCredentials } from "@spy4x/preact-system/auth-form"
import {
  AUTH_PATHS,
  authFailureMessage,
  AuthScreen,
  type AuthScreenKind,
} from "@ui/auth-screen.tsx"
import { checkTotp, signIn, signUp } from "../state/auth.ts"
import { sessionState } from "../state/session.ts"

/**
 * Wires `AuthScreen` to this app's `signIn`, `signUp` and `checkTotp`. The route picks `screen`; a
 * success reloads onto the next page.
 */
export function AuthView({ screen }: { screen: AuthScreenKind }) {
  const [, navigate] = useLocation()
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const session = sessionState.value

  /** Runs one attempt: a failure shows its message, a success reloads onto the next page. */
  const attempt = async (
    run: () => Promise<{ ok: boolean; error?: string; mfaRequired?: boolean }>,
  ) => {
    setError(null)
    setBusy(true)
    const result = await run()
    setBusy(false)
    if (!result.ok) {
      setError(result.error || authFailureMessage(screen))
      return
    }
    location.href = result.mfaRequired ? AUTH_PATHS["one-time-code"] : "/"
  }

  return (
    <AuthScreen
      screen={screen}
      isSignedIn={session.user !== null && !session.isMfaRequired}
      isMfaRequired={session.isMfaRequired}
      busy={busy}
      error={error}
      navigate={navigate}
      onModeChange={(mode) => navigate(AUTH_PATHS[mode])}
      onSignIn={({ login, password }: AuthCredentials) => attempt(() => signIn(login, password))}
      onSignUp={({ login, password }: AuthCredentials) => attempt(() => signUp(login, password))}
      onOneTimeCode={(code) => attempt(() => checkTotp(code))}
    />
  )
}
