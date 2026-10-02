import { expect } from "@std/expect"
import { afterEach, describe, it } from "@std/testing/bdd"
import { renderToString } from "preact-render-to-string"
import { Router } from "wouter-preact"
import { FREE_PLAN_ID, type GroupBilling, PRO_PLAN_ID } from "@domain/billing"
import { GroupRole } from "@domain/groups"
import { VIEWERS_ONLY_HINT } from "@ui/group-invitations.tsx"
import { billingStore } from "../state/billing.ts"
import { groupsStore } from "../state/groups.ts"
import { membersStore } from "../state/members.ts"
import { GroupSettingsView, transferAndRefresh } from "./GroupSettingsView.tsx"

const known = {
  id: "7b6d8d6c-1af5-4f04-8ae4-b1ee5d111001",
  name: "Secret Team",
  role: GroupRole.ADMIN,
  authorizationRevision: "1",
  changeSequence: "1",
  updatedAt: "2026-10-02T00:00:00.000Z",
}
const strangerId = "7b6d8d6c-1af5-4f04-8ae4-b1ee5d111999"

/** The view on the server: the router needs a path, because there is no `location`. */
const render = (groupId: string) =>
  renderToString(
    <Router ssrPath="/">
      <GroupSettingsView groupId={groupId} />
    </Router>,
  )

describe("GroupSettingsView", () => {
  afterEach(() => {
    groupsStore.reset()
    membersStore.reset()
    billingStore.reset()
  })

  it("says the group does not exist, and shows no other group, for an address that names a group the person is not in", () => {
    groupsStore.groups.value = [known]

    const html = render(strangerId)

    expect(html).toContain("This group does not exist.")
    expect(html).not.toContain("Secret Team")
    expect(html).not.toContain("Admin")
  })

  it("shows the group's name and role when the address names a group in the list", () => {
    groupsStore.groups.value = [known]

    const html = render(known.id)

    expect(html).toContain("Secret Team")
    expect(html).toContain("Admin")
  })

  it("shows the error, not a loading message, when the first read failed and nothing is held", () => {
    groupsStore.loadError.value = "Could not load the groups"

    const html = render(known.id)

    expect(html).toContain("Could not load the groups")
    expect(html).not.toContain("Loading the group...")
  })

  it("shows the members the store holds for this group, and never another group's", () => {
    groupsStore.groups.value = [known]
    membersStore.members.value = [{
      userId: 2,
      name: "Vera Viewer",
      email: null,
      role: GroupRole.VIEWER,
      joinedAt: "2026-10-01T00:00:00.000Z",
      isYou: false,
    }]

    membersStore.groupId.value = strangerId
    expect(render(known.id)).not.toContain("Vera Viewer")

    membersStore.groupId.value = known.id
    expect(render(known.id)).toContain("Vera Viewer")
  })

  it("offers invitations for viewers only while the group's plan lacks roles, and every role until the plan is read", () => {
    groupsStore.groups.value = [known]
    const plan = (planId: string): GroupBilling => ({
      enabled: true,
      planId,
      status: null,
      currentPeriodEnd: null,
      cancelAtPeriodEnd: false,
      canManage: false,
      subscribed: false,
      hasCustomer: false,
      trialEnd: null,
      notice: null,
    })
    const hint = VIEWERS_ONLY_HINT

    expect(render(known.id)).not.toContain(hint)
    billingStore.current.value = { groupId: known.id, billing: plan(FREE_PLAN_ID) }
    expect(render(known.id)).toContain(hint)
    billingStore.current.value = { groupId: strangerId, billing: plan(FREE_PLAN_ID) }
    expect(render(known.id)).not.toContain(hint)
    billingStore.current.value = { groupId: known.id, billing: plan(PRO_PLAN_ID) }
    expect(render(known.id)).not.toContain(hint)
  })

  it("shows the transfer section to the owner only, offering every other member", () => {
    const vera = {
      userId: 2,
      name: "Vera Viewer",
      email: null,
      role: GroupRole.VIEWER,
      joinedAt: "2026-10-01T00:00:00.000Z",
      isYou: false,
    }
    membersStore.groupId.value = known.id
    membersStore.members.value = [{
      ...vera,
      userId: 1,
      name: "Olga Owner",
      role: GroupRole.OWNER,
      isYou: true,
    }, vera]

    groupsStore.groups.value = [known]
    expect(render(known.id)).not.toContain(`data-e2e="group-section-transfer"`)

    groupsStore.groups.value = [{ ...known, role: GroupRole.OWNER }]
    const html = render(known.id)
    expect(html).toContain(`data-e2e="group-section-transfer"`)
    expect(html).toMatch(/<option[^>]*value="2"[^>]*>Vera Viewer<\/option>/)
    expect(html).not.toMatch(/<option[^>]*>Olga Owner<\/option>/)
  })

  it("tells the owner the subscription moves and stays on their card, for the open group's plan only", () => {
    groupsStore.groups.value = [{ ...known, role: GroupRole.OWNER }]
    membersStore.groupId.value = known.id
    membersStore.members.value = [
      {
        userId: 1,
        name: "Olga Owner",
        email: null,
        role: GroupRole.OWNER,
        joinedAt: "2026-10-01T00:00:00.000Z",
        isYou: true,
      },
      {
        userId: 2,
        name: "Vera Viewer",
        email: null,
        role: GroupRole.VIEWER,
        joinedAt: "2026-10-01T00:00:00.000Z",
        isYou: false,
      },
    ]
    const subscribed: GroupBilling = {
      enabled: true,
      planId: PRO_PLAN_ID,
      status: null,
      currentPeriodEnd: null,
      cancelAtPeriodEnd: false,
      canManage: true,
      subscribed: true,
      hasCustomer: true,
      trialEnd: null,
      notice: null,
    }
    const sentence = "stays on your card"

    expect(render(known.id)).not.toContain(sentence)
    billingStore.current.value = { groupId: strangerId, billing: subscribed }
    expect(render(known.id)).not.toContain(sentence)
    billingStore.current.value = { groupId: known.id, billing: subscribed }
    expect(render(known.id)).toContain(sentence)
  })
})

describe("transferAndRefresh", () => {
  it("reads the groups again after a transfer that worked, so the new role shows", async () => {
    let reads = 0
    const moved = await transferAndRefresh(
      { transfer: () => Promise.resolve(true) },
      { refreshFromUser: () => Promise.resolve(void reads++) },
    )

    expect(moved).toBe(true)
    expect(reads).toBe(1)
  })

  it("leaves the groups alone after a refused transfer", async () => {
    let reads = 0
    const moved = await transferAndRefresh(
      { transfer: () => Promise.resolve(false) },
      { refreshFromUser: () => Promise.resolve(void reads++) },
    )

    expect(moved).toBe(false)
    expect(reads).toBe(0)
  })
})
