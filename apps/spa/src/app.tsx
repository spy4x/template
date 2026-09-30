import "./app.css"
import { useEffect, useState } from "preact/hooks"
import { SWUpdater } from "@spy4x/preact-system/sw-updater"
import { LoadingSpinner } from "@spy4x/preact-ui/loading-spinner"
import { Toastr } from "@spy4x/preact-ui/toastr"
import { Route, Switch } from "wouter-preact"
import { canSignOut, sessionState } from "./state/session.ts"
import { bootstrapSession } from "./state/auth.ts"
import { groupsStore } from "./state/groups.ts"
import { notesStore } from "./state/notes.ts"
import { connectRealtime, disconnectRealtime } from "./state/realtime.ts"
import { toasts } from "./state/toasts.ts"
import { AuthView } from "./views/AuthView.tsx"
import { GroupsView } from "./views/GroupsView.tsx"
import { NotesView } from "./views/NotesView.tsx"
import { ProfileView } from "./views/ProfileView.tsx"
import { AppShell, PublicFrame } from "./views/AppShell.tsx"

function Routes() {
  return (
    <Switch>
      <Route path="/sign-up">{() => <AuthView key="sign-up" screen="sign-up" />}</Route>
      <Route path="/sign-in">{() => <AuthView key="sign-in" screen="sign-in" />}</Route>
      <Route path="/totp">{() => <AuthView key="one-time-code" screen="one-time-code" />}</Route>
      <Route path="/groups" component={GroupsView} />
      <Route path="/groups/:groupId/notes">
        {(params) => <NotesView groupId={params.groupId} />}
      </Route>
      <Route path="/groups/:groupId/notes/:noteId">
        {(params) => <NotesView groupId={params.groupId} noteId={params.noteId} />}
      </Route>
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
    const userId = sessionState.value.user?.id
    if (userId === undefined || sessionState.value.isMfaRequired) {
      // Signed out, or the second factor is still owed: drop the socket, the cursors and the data.
      disconnectRealtime({ forget: true })
      groupsStore.reset()
      notesStore.reset()
      return
    }
    // The REST read is the pull: it runs at start-up, after every reconnect and for every push
    // that is news, so a missed frame costs one read and never leaves the list wrong. A note
    // change moves its group's sequence, so the open group's notes are read again too.
    const pull = async (gap?: { groupId: string }) => {
      const openGroup = notesStore.groupId.value
      await Promise.all([
        groupsStore.refresh(),
        openGroup && (!gap || gap.groupId === openGroup) ? notesStore.refresh() : undefined,
      ])
    }
    void pull().catch(() => {})
    connectRealtime(userId, pull)
    return () => disconnectRealtime()
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
