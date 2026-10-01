import { expect } from "@std/expect"
import { afterEach, describe, it } from "@std/testing/bdd"
import { renderToString } from "preact-render-to-string"
import { Router } from "wouter-preact"
import { GroupKind, GroupRole } from "@domain/groups"
import { groupsStore } from "../state/groups.ts"
import { GroupSettingsView } from "./GroupSettingsView.tsx"

const known = {
  id: "7b6d8d6c-1af5-4f04-8ae4-b1ee5d111001",
  kind: GroupKind.SHARED,
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
  afterEach(() => groupsStore.reset())

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
})
