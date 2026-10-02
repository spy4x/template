/// <reference lib="deno.ns" />
import { expect } from "@std/expect"
import postgres from "postgres"
import { sha256Hex } from "@spy4x/platform/tokens"
import { PlanError } from "@domain/billing"
import { GroupError, GroupRole, InvitationError } from "@domain/groups"
import {
  type InvitationCreateRecord,
  invitationLookup,
  newInvitationToken,
  PostgresInvitationRepository,
} from "@server/groups/postgres-invitation-repository.ts"
import { insertUser, team, withSchema } from "./group-team.ts"

/**
 * Group invitations against a real Postgres built from schema.sql: what a create stores, who may
 * invite with which role, accepting, and every reason an invitation is refused. Needs "DB_HOST",
 * "DB_USER", "DB_PASS" and "DB_NAME" (recipe in docs/handoff.md); it fails when they are missing.
 */

async function refusal(write: Promise<unknown>): Promise<string> {
  try {
    await write
  } catch (error) {
    if (
      error instanceof InvitationError || error instanceof GroupError || error instanceof PlanError
    ) {
      return error.code
    }
    throw error
  }
  throw new Error("The write was not refused")
}

/** Creates an invitation the way the API does, and answers it with its token. */
async function invite(
  invitations: PostgresInvitationRepository,
  groupId: string,
  actorId: number,
  options: Partial<InvitationCreateRecord> & { allowance?: number | null } = {},
) {
  const token = newInvitationToken()
  const { allowance = null, ...record } = options
  const created = await invitations.create(
    {
      groupId,
      role: GroupRole.EDITOR,
      expiresInDays: 7,
      maxUses: 1,
      email: null,
      tokenHash: await sha256Hex(token),
      ...record,
    },
    actorId,
    allowance,
  )
  if (!created) throw new Error("The invitation was not created")
  return { ...created, token, lookup: await invitationLookup({ token }) }
}

async function memberRole(sql: postgres.Sql, groupId: string, userId: number) {
  return (await sql<{ role: number }[]>`
    SELECT role FROM group_members WHERE group_id = ${groupId} AND user_id = ${userId}
  `)[0]?.role ?? null
}

async function auditKinds(sql: postgres.Sql, groupId: string): Promise<string[]> {
  const rows = await sql<{ eventKind: string }[]>`
    SELECT event_kind FROM audit_events
    WHERE group_id = ${groupId} AND event_kind LIKE 'group.invitation%'
    ORDER BY id
  `
  return rows.map((row) => row.eventKind)
}

async function proveAddress(sql: postgres.Sql, userId: number, email: string) {
  await sql`INSERT INTO auth_email_owners (email, user_id) VALUES (${email}, ${userId})`
}

Deno.test("invitations: the database stores the token's hash, never the token", async () => {
  await withSchema(async (sql) => {
    const { groupId, owner } = await team(sql)
    const invitations = new PostgresInvitationRepository(sql)
    const { invitation, token } = await invite(invitations, groupId, owner)
    const [row] = await sql<Record<string, unknown>[]>`
      SELECT * FROM group_invitations WHERE id = ${invitation.id}
    `
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(row.tokenHash).toBe(await sha256Hex(token))
    for (const value of Object.values(row)) {
      expect(String(value)).not.toContain(token)
    }
  })
})

Deno.test("invitations: another user accepts a link with its role, and the group becomes selected", async () => {
  await withSchema(async (sql) => {
    const { groupId, admin, stranger } = await team(sql)
    const invitations = new PostgresInvitationRepository(sql)
    const { lookup } = await invite(invitations, groupId, admin, { role: GroupRole.VIEWER })

    const result = await invitations.accept(lookup, stranger, null, "request-1")

    expect(result.groupId).toBe(groupId)
    expect(result.role).toBe(GroupRole.VIEWER)
    expect(result.selected.groupId).toBe(groupId)
    expect(await memberRole(sql, groupId, stranger)).toBe(GroupRole.VIEWER)
    const [settings] = await sql<{ selectedGroupId: string }[]>`
      SELECT selected_group_id FROM user_settings WHERE user_id = ${stranger}
    `
    expect(settings.selectedGroupId).toBe(groupId)
    expect(await auditKinds(sql, groupId)).toEqual([
      "group.invitation_created",
      "group.invitation_accepted",
    ])
  })
})

Deno.test("invitations: an admin invites viewers and editors only; the owner invites admins", async () => {
  await withSchema(async (sql) => {
    const { groupId, owner, admin, editor } = await team(sql)
    const invitations = new PostgresInvitationRepository(sql)

    expect(await refusal(invite(invitations, groupId, admin, { role: GroupRole.ADMIN })))
      .toBe("ROLE_INSUFFICIENT")
    expect(await refusal(invite(invitations, groupId, editor, { role: GroupRole.VIEWER })))
      .toBe("ROLE_INSUFFICIENT")
    await invite(invitations, groupId, admin, { role: GroupRole.EDITOR })
    await invite(invitations, groupId, owner, { role: GroupRole.ADMIN })
    expect(await auditKinds(sql, groupId)).toEqual([
      "group.invitation_created",
      "group.invitation_created",
    ])
  })
})

Deno.test("invitations: an expired, revoked or used-up invitation is refused", async () => {
  await withSchema(async (sql) => {
    const { groupId, owner, admin, editor, stranger } = await team(sql)
    const invitations = new PostgresInvitationRepository(sql)
    const late = await insertUser(sql)

    const expired = await invite(invitations, groupId, owner)
    await sql`
      UPDATE group_invitations SET expires_at = now() - interval '1 second'
      WHERE id = ${expired.invitation.id}
    `
    expect(await refusal(invitations.accept(expired.lookup, stranger, null)))
      .toBe("INVITATION_EXPIRED")

    const revoked = await invite(invitations, groupId, owner)
    expect(await invitations.revoke(groupId, revoked.invitation.id, admin)).toBe(true)
    expect(await refusal(invitations.accept(revoked.lookup, stranger, null)))
      .toBe("INVITATION_REVOKED")

    const once = await invite(invitations, groupId, owner, { maxUses: 1 })
    await invitations.accept(once.lookup, stranger, null)
    expect(await refusal(invitations.accept(once.lookup, late, null))).toBe("INVITATION_USED_UP")

    expect(await refusal(invitations.accept({ tokenHash: "0".repeat(64) }, late, null)))
      .toBe("INVITATION_NOT_FOUND")
    expect(await memberRole(sql, groupId, late)).toBe(null)
    // An editor may not revoke.
    expect(await refusal(invitations.revoke(groupId, once.invitation.id, editor)))
      .toBe("ROLE_INSUFFICIENT")
  })
})

Deno.test("invitations: the pending list drops revoked, expired and used-up invitations", async () => {
  await withSchema(async (sql) => {
    const { groupId, owner, admin, viewer, stranger } = await team(sql)
    const invitations = new PostgresInvitationRepository(sql)
    const pending = await invite(invitations, groupId, owner, { maxUses: 2 })
    const used = await invite(invitations, groupId, owner)
    const revoked = await invite(invitations, groupId, owner)
    const expired = await invite(invitations, groupId, owner)
    await invitations.accept(used.lookup, stranger, null)
    await invitations.revoke(groupId, revoked.invitation.id, owner)
    await sql`
      UPDATE group_invitations SET expires_at = now() - interval '1 second'
      WHERE id = ${expired.invitation.id}
    `

    const list = await invitations.listPending(groupId, admin)

    expect(list?.map((invitation) => invitation.id)).toEqual([pending.invitation.id])
    expect(await refusal(invitations.listPending(groupId, viewer))).toBe("ROLE_INSUFFICIENT")
    expect(await invitations.listPending(groupId, await insertUser(sql))).toBe(null)
  })
})

Deno.test("invitations: a full group refuses a create and an accept, and pending ones take no seat", async () => {
  await withSchema(async (sql) => {
    // The team has five members: the owner, an admin, an editor, a viewer and "onlyHere".
    const { groupId, owner, stranger } = await team(sql)
    const invitations = new PostgresInvitationRepository(sql)
    const late = await insertUser(sql)

    expect(await refusal(invite(invitations, groupId, owner, { allowance: 5 })))
      .toBe("PLAN_LIMIT_REACHED")
    const first = await invite(invitations, groupId, owner, { allowance: 6 })
    const second = await invite(invitations, groupId, owner, { allowance: 6 })

    await invitations.accept(first.lookup, stranger, 6)
    expect(await refusal(invitations.accept(second.lookup, late, 6))).toBe("PLAN_LIMIT_REACHED")
    expect(await memberRole(sql, groupId, late)).toBe(null)
    expect(await invitations.accept(second.lookup, late, null)).toMatchObject({ groupId })
  })
})

Deno.test("invitations: one tied to an address is for the account that proved it alone", async () => {
  await withSchema(async (sql) => {
    const { groupId, owner, stranger } = await team(sql)
    const invitations = new PostgresInvitationRepository(sql)
    const invited = await insertUser(sql)
    await proveAddress(sql, invited, "invited@example.com")
    const { invitation, lookup } = await invite(invitations, groupId, owner, {
      email: "invited@example.com",
    })

    expect(await refusal(invitations.accept(lookup, stranger, null)))
      .toBe("INVITATION_WRONG_ACCOUNT")
    expect((await invitations.preview(lookup, stranger)).forYou).toBe(false)
    expect(await invitations.listForUser(stranger)).toEqual([])
    const mine = await invitations.listForUser(invited)
    expect(mine.map((preview) => [preview.id, preview.forYou])).toEqual([[invitation.id, true]])

    await invitations.accept({ invitationId: invitation.id }, invited, null)
    expect(await memberRole(sql, groupId, invited)).toBe(GroupRole.EDITOR)
  })
})

Deno.test("invitations: knowing a link invitation's id lets nobody in", async () => {
  await withSchema(async (sql) => {
    const { groupId, owner, stranger } = await team(sql)
    const invitations = new PostgresInvitationRepository(sql)
    const { invitation } = await invite(invitations, groupId, owner)

    expect(await refusal(invitations.accept({ invitationId: invitation.id }, stranger, null)))
      .toBe("INVITATION_NOT_FOUND")
    expect(await memberRole(sql, groupId, stranger)).toBe(null)
  })
})

Deno.test("invitations: declining one tied to an address stops it; a member cannot join twice", async () => {
  await withSchema(async (sql) => {
    const { groupId, owner, editor } = await team(sql)
    const invitations = new PostgresInvitationRepository(sql)
    const invited = await insertUser(sql)
    await proveAddress(sql, invited, "invited@example.com")
    const addressed = await invite(invitations, groupId, owner, { email: "invited@example.com" })

    await invitations.decline(addressed.lookup, invited)
    expect(await refusal(invitations.accept(addressed.lookup, invited, null)))
      .toBe("INVITATION_REVOKED")
    expect(await invitations.listForUser(invited)).toEqual([])

    const link = await invite(invitations, groupId, owner)
    expect(await refusal(invitations.accept(link.lookup, editor, null))).toBe("ALREADY_MEMBER")
    expect(await auditKinds(sql, groupId)).toEqual([
      "group.invitation_created",
      "group.invitation_declined",
      "group.invitation_created",
    ])
  })
})
