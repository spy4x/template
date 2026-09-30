import "./app.css"
import { useEffect, useState } from "preact/hooks"
import { SWUpdater } from "@spy4x/preact-system/sw-updater"
import { LoadingSpinner } from "@spy4x/preact-ui/loading-spinner"
import { Toastr } from "@spy4x/preact-ui/toastr"
import { Route, Switch } from "wouter-preact"
import { canSignOut, sessionState } from "./state/session.ts"
import { bootstrapSession } from "./state/auth.ts"
import { wsClient } from "./state/ws.ts"
import { toasts } from "./state/toasts.ts"
import { AuthView } from "./views/AuthView.tsx"
import { ProfileView } from "./views/ProfileView.tsx"
import { AppShell, PublicFrame } from "./components/AppShell.tsx"

function Routes() {
  return (
    <Switch>
      <Route path="/sign-up">{() => <AuthView key="sign-up" screen="sign-up" />}</Route>
      <Route path="/sign-in">{() => <AuthView key="sign-in" screen="sign-in" />}</Route>
      <Route path="/totp">{() => <AuthView key="one-time-code" screen="one-time-code" />}</Route>
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
    <PublicFrame canSignOut={canSignOut(session)}>
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

  return (
    <>
      {!ready || !sessionState.value.isReady
        ? (
          <main>
            <LoadingSpinner size="lg" label="Loading..." class="min-h-dvh bg-canvas" />
          </main>
        )
        : <Frame />}
      <Toastr
        toasts={toasts.list.value}
        onDismiss={toasts.remove}
        dataE2E="toasts"
      />
      <SWUpdater />
    </>
  )
}
