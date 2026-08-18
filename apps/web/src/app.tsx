import "./app.css"
import { useEffect, useState } from "preact/hooks"
import { Route, Switch } from "wouter-preact"
import { sessionState } from "./state/session.ts"
import { bootstrapSession, signOut } from "./state/auth.ts"
import { wsClient } from "./state/ws.ts"
import { SignInView } from "./views/SignInView.tsx"
import { SignUpView } from "./views/SignUpView.tsx"
import { TotpView } from "./views/TotpView.tsx"
import { ProfileView } from "./views/ProfileView.tsx"

function Shell() {
  const session = sessionState.value
  return (
    <div class="min-h-screen bg-slate-950 text-slate-100">
      <header class="border-b border-slate-800">
        <div class="mx-auto flex min-h-16 max-w-5xl items-center justify-between px-4 py-3 sm:h-16 sm:px-6 sm:py-0">
          <div class="flex items-center gap-3">
            <div class="h-8 w-8 rounded-xl bg-indigo-500"></div>
            <div class="text-lg font-semibold">Financy</div>
          </div>
          <div class="flex items-center gap-4 text-sm text-slate-300">
            {session.user
              ? (
                <>
                  <span class="hidden sm:block">{session.user.firstName || "User"}</span>
                  <button
                    type="button"
                    data-e2e="signout"
                    class="rounded-md border border-slate-700 px-3 py-2 text-sm hover:border-slate-500"
                    onClick={() => signOut()}
                  >
                    Sign out
                  </button>
                </>
              )
              : <span>Guest</span>}
          </div>
        </div>
      </header>
      <main class="mx-auto w-full max-w-5xl px-6 py-10">
        <Switch>
          <Route path="/sign-up" component={SignUpView} />
          <Route path="/sign-in" component={SignInView} />
          <Route path="/totp" component={TotpView} />
          <Route path="/" component={ProfileView} />
        </Switch>
      </main>
    </div>
  )
}

export function App() {
  const [ready, setReady] = useState(false)
  useEffect(() => {
    bootstrapSession().finally(() => setReady(true))
  }, [])

  useEffect(() => {
    if (!sessionState.value.user || sessionState.value.isMfaRequired) {
      wsClient.disconnect()
      return
    }
    wsClient.connect()
    return () => wsClient.disconnect()
  }, [
    sessionState.value.user?.id,
    sessionState.value.isMfaRequired,
  ])

  if (!ready || !sessionState.value.isReady) {
    return (
      <div class="min-h-screen bg-slate-950 text-slate-100">
        <div class="mx-auto max-w-5xl px-6 py-10">
          <div class="rounded-2xl border border-slate-800 bg-slate-900 p-8 text-slate-300">
            Loading...
          </div>
        </div>
      </div>
    )
  }
  return <Shell />
}
