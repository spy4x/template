import "./app.css"
import { useEffect, useState } from "preact/hooks"
import { Route, Switch } from "wouter-preact"
import { sessionState } from "./state/session.ts"
import { bootstrapSession } from "./state/auth.ts"
import { wsClient } from "./state/ws.ts"
import { SignInView } from "./views/SignInView.tsx"
import { SignUpView } from "./views/SignUpView.tsx"
import { TotpView } from "./views/TotpView.tsx"
import { ProfileView } from "./views/ProfileView.tsx"
import { AppShell, PublicFrame } from "./components/AppShell.tsx"

function Routes() {
  return (
    <Switch>
      <Route path="/sign-up" component={SignUpView} />
      <Route path="/sign-in" component={SignInView} />
      <Route path="/totp" component={TotpView} />
      <Route path="/" component={ProfileView} />
    </Switch>
  )
}

/** A fully signed-in user gets the library `Shell`; everyone else the plain public frame. */
function Frame() {
  const session = sessionState.value
  if (session.user && !session.isMfaRequired) {
    return (
      <AppShell user={session.user} wsStatus={session.wsStatus}>
        <Routes />
      </AppShell>
    )
  }
  return (
    <PublicFrame canSignOut={session.user !== null}>
      <Routes />
    </PublicFrame>
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
  return <Frame />
}
