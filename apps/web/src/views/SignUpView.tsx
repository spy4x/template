import { useState } from "preact/hooks"
import { Link } from "wouter-preact"
import { signUp } from "../state/auth.ts"
import { sessionState } from "../state/session.ts"

export function SignUpView() {
  const [username, setUsername] = useState("")
  const [password, setPassword] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const submit = async (event: Event) => {
    event.preventDefault()
    setError(null)
    setBusy(true)
    const result = await signUp(username, password)
    setBusy(false)
    if (!result.ok) {
      setError(result.error || "Sign up failed")
      return
    }
    if (result.mfaRequired) {
      location.href = "/totp"
    } else {
      location.href = "/"
    }
  }

  if (sessionState.value.user && !sessionState.value.isMfaRequired) {
    return (
      <div class="rounded-2xl border border-slate-800 bg-slate-900 p-6 sm:p-8">
        <h2 class="text-xl font-semibold">Already signed in</h2>
        <p class="mt-2 text-slate-300">Go to your profile.</p>
        <div class="mt-6">
          <Link href="/" class="text-indigo-400 hover:text-indigo-300">Open profile</Link>
        </div>
      </div>
    )
  }

  return (
    <div class="mx-auto grid max-w-4xl gap-6 lg:grid-cols-2">
      <div class="rounded-2xl border border-slate-800 bg-slate-900 p-6 sm:p-8">
        <h1 class="text-2xl font-semibold sm:text-3xl">Create account</h1>
        <p class="mt-2 text-slate-300">Start with a username and password.</p>
        <div class="mt-6 space-y-4 text-sm text-slate-400">
          <div class="rounded-xl border border-slate-800 p-4">MFA supported.</div>
          <div class="rounded-xl border border-slate-800 p-4">Push device control.</div>
        </div>
      </div>
      <form
        class="rounded-2xl border border-slate-800 bg-slate-900 p-6 sm:p-8"
        onSubmit={submit}
      >
        <div class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <h2 class="text-xl font-semibold">Sign up</h2>
          <Link href="/sign-in" class="text-sm text-indigo-400 hover:text-indigo-300">
            Already have account
          </Link>
        </div>
        <div class="mt-6 space-y-4">
          <label class="block text-sm">
            <span class="text-slate-300">Username</span>
            <input
              data-e2e="signup-username"
              class="mt-2 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-3 text-base text-slate-100"
              value={username}
              onInput={(e) => setUsername((e.target as HTMLInputElement).value)}
              required
            />
          </label>
          <label class="block text-sm">
            <span class="text-slate-300">Password</span>
            <input
              data-e2e="signup-password"
              type="password"
              class="mt-2 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-3 text-base text-slate-100"
              value={password}
              onInput={(e) => setPassword((e.target as HTMLInputElement).value)}
              required
            />
          </label>
        </div>
        {error
          ? (
            <div class="mt-4 rounded-lg border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-sm text-rose-200">
              {error}
            </div>
          )
          : null}
        <button
          data-e2e="signup-submit"
          class="mt-6 w-full rounded-lg bg-indigo-500 px-4 py-3 text-sm font-semibold text-white hover:bg-indigo-400 disabled:opacity-60"
          disabled={busy}
        >
          {busy ? "Creating..." : "Create account"}
        </button>
      </form>
    </div>
  )
}
