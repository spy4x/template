import "./app.css"
import { useEffect, useState } from "preact/hooks"
import { SWUpdater } from "@spy4x/preact-system/sw-updater"
import { LoadingSpinner } from "@spy4x/preact-ui/loading-spinner"
import { Toastr } from "@spy4x/preact-ui/toastr"
import { Route, Switch, useLocation } from "wouter-preact"
import { canSignOut, sessionState } from "./state/session.ts"
import { bootstrapSession, settleOwedSignOut } from "./state/auth.ts"
import { groupsStore } from "./state/groups.ts"
import { notesStore } from "./state/notes.ts"
import { selectionStore } from "./state/selection.ts"
import { connectRealtime, disconnectRealtime } from "./state/realtime.ts"
import { profileStore } from "./state/profile.ts"
import { userChangeGroupId } from "@domain/identity"
import { flushOutbox, startOffline, stopOffline } from "./offline/index.ts"
import { forgetUser, recallUser, rememberUser } from "./offline/session-cache.ts"
import { toasts } from "./state/toasts.ts"
import { AuthView } from "./views/AuthView.tsx"
import { ForgotPasswordView, ResetPasswordView } from "./views/PasswordResetView.tsx"
import { GroupsView } from "./views/GroupsView.tsx"
import { NotesView } from "./views/NotesView.tsx"
import { ProfileView } from "./views/ProfileView.tsx"
import { AppShell, PublicFrame } from "./views/AppShell.tsx"
import { NOTE_PATHS, SCREEN_PATHS } from "@ui/progressive.tsx"

/**
 * An old `/groups/:groupId/notes…` link. It selects nothing: a link must not change the selection,
 * or another site could switch a person's group by linking here. When that group is already the
 * selected one it opens the notes at their new address; otherwise it opens the groups page, which
 * has an "Open notes" button for each group. It waits for the selection to be known.
 */
function OpenIfSelected({ groupId, noteId }: { groupId: string; noteId?: string }) {
  const [, navigate] = useLocation()
  const selected = selectionStore.groupId.value
  useEffect(() => {
    if (selected === null) return
    navigate(
      selected !== groupId
        ? SCREEN_PATHS.groups
        : noteId
        ? NOTE_PATHS.note(noteId)
        : NOTE_PATHS.list,
      { replace: true },
    )
  }, [selected, groupId, noteId])
  return <LoadingSpinner size="lg" label="Opening the notes..." class="min-h-[50vh]" />
}

function Routes() {
  return (
    <Switch>
      <Route path="/sign-up">{() => <AuthView key="sign-up" screen="sign-up" />}</Route>
      <Route path="/sign-in">{() => <AuthView key="sign-in" screen="sign-in" />}</Route>
      <Route path="/totp">{() => <AuthView key="one-time-code" screen="one-time-code" />}</Route>
      <Route path="/forgot-password" component={ForgotPasswordView} />
      <Route path="/reset-password" component={ResetPasswordView} />
      <Route path="/groups" component={GroupsView} />
      <Route path="/groups/:groupId/notes">
        {(params) => <OpenIfSelected groupId={params.groupId} />}
      </Route>
      <Route path="/groups/:groupId/notes/:noteId">
        {(params) => <OpenIfSelected groupId={params.groupId} noteId={params.noteId} />}
      </Route>
      <Route path="/notes">{() => <NotesView />}</Route>
      <Route path="/notes/:noteId">{(params) => <NotesView noteId={params.noteId} />}</Route>
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
    bootstrapSession(recallUser).finally(() => setReady(true))
  }, [])

  useEffect(() => {
    // A sign-out made offline reaches the server as soon as the browser is online again.
    const settle = () => void settleOwedSignOut()
    addEventListener("online", settle)
    return () => removeEventListener("online", settle)
  }, [])

  useEffect(() => {
    // The user is remembered for the next start with no network, and forgotten on sign-out.
    const { user, isReady, isMfaRequired } = sessionState.value
    if (user && !isMfaRequired) rememberUser(user)
    else if (isReady && !user) forgetUser()
  }, [sessionState.value.user, sessionState.value.isReady, sessionState.value.isMfaRequired])

  // A change made in another tab while this socket was down is read when it opens again.
  useEffect(() => profileStore.onSocketStatus(sessionState.value.wsStatus), [
    sessionState.value.wsStatus,
  ])

  useEffect(() => {
    const userId = sessionState.value.user?.id
    if (userId === undefined || sessionState.value.isMfaRequired) {
      // Signed out, or the second factor is still owed: drop the socket, the cursors and the data.
      disconnectRealtime({ forget: true })
      void stopOffline({ forget: true })
      groupsStore.reset()
      notesStore.reset()
      profileStore.reset()
      selectionStore.reset()
      return
    }
    // The REST read is the pull: it runs at start-up, after every reconnect and for every push
    // that is news, so a missed frame costs one read and never leaves the list wrong. A note
    // change moves its group's sequence, so the open group's notes are read again too.
    const pull = async (gap?: { groupId: string }) => {
      // The hint for this person's own changes (profile, push devices, selected group), sent after
      // a change in another tab.
      if (gap?.groupId === userChangeGroupId(userId)) {
        return await Promise.all([profileStore.refresh(), selectionStore.refresh()]).then(() => {})
      }
      // Writes made offline go out before anything is read, so the read shows their result.
      await flushOutbox()
      const openGroup = notesStore.groupId.value
      await Promise.all([
        selectionStore.refresh(),
        groupsStore.refresh(),
        openGroup && (!gap || gap.groupId === openGroup) ? notesStore.refresh() : undefined,
      ])
    }
    startOffline(userId)
    selectionStore.start(userId)
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
