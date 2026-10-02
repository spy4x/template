import { useEffect } from "preact/hooks"
import { useLocation } from "wouter-preact"
import { GroupSettingsScreen } from "@ui/group-settings-screen.tsx"
import { GroupInvitationsSection } from "@ui/group-invitations.tsx"
import { GroupTransferSection } from "@ui/group-transfer.tsx"
import { canManageInvitations } from "@domain/groups"
import { entitlementsOf } from "@domain/billing"
import { NOTE_PATHS, SCREEN_PATHS } from "@ui/progressive.tsx"
import { groupsStore } from "../state/groups.ts"
import { membersStore } from "../state/members.ts"
import { selectionStore } from "../state/selection.ts"
import { billingStore } from "../state/billing.ts"
import { invitationsStore } from "../state/invitations.ts"
import { GroupBillingCard } from "./BillingViews.tsx"

/**
 * Wires one group's settings screen to the groups store, which already holds every group, and to
 * the members store, which reads this group's members when the page opens.
 */
export function GroupSettingsView({ groupId }: { groupId: string }) {
  const [, navigate] = useLocation()
  const store = groupsStore
  const team = membersStore
  const invites = invitationsStore
  // Closing the page forgets the members, so a later pull does not read them for nobody. It
  // forgets a new invitation's link too: the link is shown once.
  useEffect(() => {
    void team.open(groupId)
    return () => {
      team.reset()
      invites.closeGroup()
    }
  }, [groupId])
  const role = store.groups.value.find((candidate) => candidate.id === groupId)?.role
  // Only the owner and admins may read the invitations; the API refuses everyone else.
  useEffect(() => {
    if (role !== undefined && canManageInvitations(role)) void invites.open(groupId)
  }, [groupId, role])
  const invitesOurs = invites.groupId.value === groupId
  // The billing card reads the group's plan; until it has, the server alone judges the role.
  const billingOurs = billingStore.current.value?.groupId === groupId
    ? billingStore.current.value.billing
    : null
  // Until the store has switched to this group, it holds another group's members.
  const ours = team.groupId.value === groupId
  const group = store.groups.value.find((candidate) => candidate.id === groupId) ?? null
  const draft = store.renameDraft.value
  const working = store.working.value
  // An error of another group's page is not this page's.
  const failure = store.actionError.value?.groupId === groupId ? store.actionError.value : null
  return (
    <GroupSettingsScreen
      group={group}
      selected={selectionStore.groupId.value === groupId}
      // A person always has a group, so an empty list means the first read has not answered yet.
      loading={store.loading.value || store.groups.value.length === 0}
      error={store.loadError.value}
      navigate={navigate}
      onOpen={(id) => {
        void selectionStore.select(id)
        navigate(NOTE_PATHS.list)
      }}
      name={draft?.groupId === groupId ? draft.name : undefined}
      onNameChange={(name) => (store.renameDraft.value = { groupId, name })}
      renaming={working?.groupId === groupId && working.action === "rename"}
      renameError={failure?.action === "rename" ? failure.message : null}
      onRename={() => void store.rename(groupId)}
      isLastGroup={store.groups.value.length <= 1}
      hasSubscription={billingOurs?.subscribed ?? false}
      members={ours ? team.members.value : null}
      memberCount={ours ? team.memberCount.value ?? undefined : undefined}
      membersError={ours ? team.loadError.value : null}
      memberPendingId={ours ? team.pendingUserId.value : null}
      memberError={ours ? team.memberError.value : null}
      onRoleChange={(userId, role) => void team.changeRole(userId, role)}
      onRemoveMember={(userId) => void team.remove(userId)}
      leaving={ours && team.leaving.value}
      leaveError={ours ? team.leaveError.value : null}
      onLeave={() =>
        void team.leave().then(async (left) => {
          if (!left) return
          // The server may have moved this person's selection; read the list and where it went.
          // A failed list read shows its error on the Groups page. A failed selection read is left
          // alone: the leave is done, and the next pull reads the selection again.
          await Promise.all([store.refreshFromUser(), selectionStore.refresh().catch(() => {})])
          navigate(SCREEN_PATHS.groups)
        })}
      deleting={working?.groupId === groupId && working.action === "delete"}
      deleteError={failure?.action === "delete" ? failure.message : null}
      onDelete={() =>
        void store.remove(groupId).then(async (deleted) => {
          if (!deleted) return
          // The server moved everyone who had this group selected; read where this tab goes now.
          await selectionStore.refresh().catch(() => {})
          navigate(SCREEN_PATHS.groups)
        })}
      billing={group && <GroupBillingCard groupId={groupId} />}
      invitations={group && (
        <GroupInvitationsSection
          groupId={groupId}
          actorRole={group.role}
          memberRoles={billingOurs
            ? entitlementsOf(billingOurs.planId, billingOurs.enabled).features.memberRoles
            : true}
          invitations={invitesOurs ? invites.invitations.value : null}
          error={invitesOurs ? invites.loadError.value : null}
          draft={invites.draft.value}
          onDraftChange={(draft) => (invites.draft.value = draft)}
          creating={invites.creating.value}
          createError={invites.createError.value?.plan ? null : invites.createError.value?.message}
          createRefusal={invites.createError.value?.plan ?? null}
          onCreate={() => void invites.create()}
          created={invites.created.value}
          revokingId={invites.revokingId.value}
          revokeError={invites.revokeError.value}
          onRevoke={(invitationId) => void invites.revoke(invitationId)}
          navigate={navigate}
        />
      )}
      transfer={group && (
        <GroupTransferSection
          groupId={groupId}
          groupName={group.name}
          role={group.role}
          members={ours ? team.members.value : null}
          hasSubscription={billingOurs?.subscribed ?? false}
          draft={team.transferDraft.value}
          onDraftChange={(next) => (team.transferDraft.value = next)}
          transferring={team.transferring.value}
          error={ours ? team.transferError.value : null}
          onTransfer={() =>
            void team.transfer().then(async (moved) => {
              // This person is an admin now: the list holds their role, so read it again.
              if (moved) await store.refreshFromUser()
            })}
        />
      )}
    />
  )
}
