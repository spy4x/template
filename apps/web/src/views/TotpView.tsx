import { useState } from "preact/hooks"
import { Link } from "wouter-preact"
import { checkTotp } from "../state/auth.ts"
import { sessionState } from "../state/session.ts"

export function TotpView() {
  const [otp, setOtp] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const submit = async (event: Event) => {
    event.preventDefault()
    setBusy(true)
    setError(null)
    const result = await checkTotp(otp)
    setBusy(false)
    if (!result.ok) {
      setError(result.error || "Invalid token")
      return
    }
    location.href = "/"
  }

  if (!sessionState.value.isMfaRequired) {
    return (
      <div class="rounded-2xl border border-slate-800 bg-slate-900 p-6 sm:p-8">
        <h2 class="text-xl font-semibold">MFA not required</h2>
        <p class="mt-2 text-slate-300">Continue to profile.</p>
        <div class="mt-6">
          <Link href="/" class="text-indigo-400 hover:text-indigo-300">Open profile</Link>
        </div>
      </div>
    )
  }

  return (
    <div class="mx-auto max-w-md rounded-2xl border border-slate-800 bg-slate-900 p-6 sm:p-8">
      <h2 class="text-xl font-semibold">2FA verification</h2>
      <p class="mt-2 text-sm text-slate-300">Enter 6-digit code.</p>
      <form class="mt-6 space-y-4" onSubmit={submit}>
        <label class="block text-sm">
          <span class="text-slate-300">One-time code</span>
          <input
            data-e2e="totp-input"
            inputMode="numeric"
            autoComplete="one-time-code"
            class="mt-2 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-3 text-base text-slate-100"
            value={otp}
            onInput={(e) => setOtp((e.target as HTMLInputElement).value)}
            required
          />
        </label>
        {error
          ? (
            <div class="rounded-lg border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-sm text-rose-200">
              {error}
            </div>
          )
          : null}
        <button
          data-e2e="totp-submit"
          class="w-full rounded-lg bg-indigo-500 px-4 py-3 text-sm font-semibold text-white hover:bg-indigo-400 disabled:opacity-60"
          disabled={busy}
        >
          {busy ? "Verifying..." : "Verify"}
        </button>
      </form>
      <div class="mt-4 text-sm text-slate-400">
        Need help? <Link href="/sign-in" class="text-indigo-400">Back to sign in</Link>
      </div>
    </div>
  )
}
