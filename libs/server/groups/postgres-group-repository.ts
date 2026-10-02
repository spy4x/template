import type postgres from "postgres"
import {
  CreatedGroup,
  CreateGroupInput,
  DeletedGroupSummary,
  FirstGroupInput,
  Group,
  GROUP_RESTORE_DAYS,
  GroupAccess,
  GroupError,
  GroupListPage,
  GroupListResult,
  GroupRepository,
  GroupRole,
  GroupSummary,
  SelectedGroup,
} from "@domain/groups"
import { recordGroupChange } from "./group-change-log.ts"

interface GroupRow extends postgres.Row {
  id: string
  name: string
  ownerUserId: number
  createdByUserId: number
  authorizationRevision: string
  nextChangeSequence: string
  createdAt: Date
  updatedAt: Date
  deletedAt: Date | null
}

interface GroupAccessRow extends GroupRow {
  role: GroupRole
}

interface GroupSummaryRow extends postgres.Row {
  id: string
  name: string
  role: GroupRole
  authorizationRevision: string
  changeSequence: string
  updatedAt: Date
}

interface ActiveUserRow extends postgres.Row {
  id: number
}

interface MemberRow extends postgres.Row {
  userId: number
}

interface DeletedGroupSummaryRow extends GroupSummaryRow {
  deletedAt: Date
}

interface SelectionRow extends postgres.Row {
  selectedGroupId: string | null
  version: number
}

const GROUP_CREATED_EVENT = "group.created"
const GROUP_RENAMED_EVENT = "group.renamed"
const GROUP_DELETED_EVENT = "group.deleted"
const GROUP_RESTORED_EVENT = "group.restored"

/** The name of the group a person gets when a deletion would leave them with none. */
const REPLACEMENT_GROUP_NAME = "Personal"

/** Most deleted groups the restore list shows; a person does not delete this many in 30 days. */
const RESTORABLE_LIST_LIMIT = 100

export class PostgresGroupRepository implements GroupRepository {
  constructor(private readonly sql: postgres.Sql) {}

  async listForUser(userId: number, page: GroupListPage): Promise<GroupListResult> {
    const limit = Math.max(1, Math.min(100, page.limit))
    const rows = await this.sql<GroupSummaryRow[]>`
      SELECT
        groups.id,
        groups.name,
        group_members.role,
        groups.authorization_revision::text AS authorization_revision,
        (groups.next_change_sequence - 1)::text AS change_sequence,
        groups.updated_at
      FROM groups
      INNER JOIN group_members
        ON group_members.group_id = groups.id
       AND group_members.user_id = ${userId}
      INNER JOIN users
        ON users.id = group_members.user_id
       AND users.deleted_at IS NULL
      WHERE groups.deleted_at IS NULL
        ${
      page.after
        ? this.sql`
          AND (
            groups.updated_at < ${page.after.updatedAt}
            OR (groups.updated_at = ${page.after.updatedAt} AND groups.id > ${page.after.id})
          )
        `
        : this.sql``
    }
      ORDER BY groups.updated_at DESC, groups.id
      LIMIT ${limit + 1}
    `
    const groups = rows.slice(0, limit)
    const last = groups.at(-1)
    return {
      groups,
      nextPageKey: rows.length > limit && last ? { updatedAt: last.updatedAt, id: last.id } : null,
    }
  }

  async getSummaryForMember(groupId: string, userId: number): Promise<GroupSummary | null> {
    const rows = await this.sql<GroupSummaryRow[]>`
      SELECT
        groups.id,
        groups.name,
        group_members.role,
        groups.authorization_revision::text AS authorization_revision,
        (groups.next_change_sequence - 1)::text AS change_sequence,
        groups.updated_at
      FROM groups
      INNER JOIN group_members
        ON group_members.group_id = groups.id
       AND group_members.user_id = ${userId}
      INNER JOIN users
        ON users.id = group_members.user_id
       AND users.deleted_at IS NULL
      WHERE groups.id = ${groupId}
        AND groups.deleted_at IS NULL
    `
    return rows[0] ?? null
  }

  async getForMember(groupId: string, userId: number): Promise<GroupAccess | null> {
    const row = (
      await this.sql<GroupAccessRow[]>`
        SELECT
          groups.id,
          groups.name,
          groups.owner_user_id,
          groups.created_by_user_id,
          groups.authorization_revision::text AS authorization_revision,
          groups.next_change_sequence::text AS next_change_sequence,
          groups.created_at,
          groups.updated_at,
          groups.deleted_at,
          group_members.role
        FROM groups
        INNER JOIN group_members
          ON group_members.group_id = groups.id
         AND group_members.user_id = ${userId}
        INNER JOIN users
          ON users.id = group_members.user_id
         AND users.deleted_at IS NULL
        WHERE groups.id = ${groupId}
          AND groups.deleted_at IS NULL
        LIMIT 1
      `
    )[0]
    return row ? { group: toGroup(row), role: row.role } : null
  }

  async listMemberUserIds(groupId: string): Promise<number[]> {
    const rows = await this.sql<MemberRow[]>`
      SELECT group_members.user_id
      FROM group_members
      INNER JOIN users ON users.id = group_members.user_id AND users.deleted_at IS NULL
      WHERE group_members.group_id = ${groupId}
      ORDER BY group_members.user_id
    `
    return rows.map((row) => row.userId)
  }

  /**
   * The group the person works in: the one they chose, while they are still a member of it and it
   * is not deleted, else the oldest group they belong to. A read only: the fallback is not stored, so
   * a read can never overwrite a choice committed at the same moment, and it announces nothing.
   * It is the same answer every time until membership changes, so every device agrees on it.
   */
  async getSelected(userId: number): Promise<SelectedGroup> {
    const stored = (
      await this.sql<SelectionRow[]>`
        SELECT selected_group_id, version FROM user_settings WHERE user_id = ${userId}
      `
    )[0]
    if (stored?.selectedGroupId && await this.isMember(stored.selectedGroupId, userId)) {
      return { groupId: stored.selectedGroupId, version: stored.version }
    }
    const fallback = (
      await this.sql<{ id: string }[]>`
        SELECT groups.id
        FROM groups
        INNER JOIN group_members
          ON group_members.group_id = groups.id
         AND group_members.user_id = ${userId}
        INNER JOIN users ON users.id = group_members.user_id AND users.deleted_at IS NULL
        WHERE groups.deleted_at IS NULL
        ORDER BY groups.created_at, groups.id
        LIMIT 1
      `
    )[0]
    return { groupId: fallback?.id ?? null, version: stored?.version ?? 0 }
  }

  async select(userId: number, groupId: string): Promise<SelectedGroup | null> {
    return await this.sql.begin(async (transaction: postgres.TransactionSql) => {
      const repository = new PostgresGroupRepository(transaction)
      if (!await repository.isMember(groupId, userId)) return null
      return await repository.storeSelection(userId, groupId)
    })
  }

  private async isMember(groupId: string, userId: number): Promise<boolean> {
    const rows = await this.sql`
      SELECT 1
      FROM groups
      INNER JOIN group_members
        ON group_members.group_id = groups.id
       AND group_members.user_id = ${userId}
      INNER JOIN users ON users.id = group_members.user_id AND users.deleted_at IS NULL
      WHERE groups.id = ${groupId}
        AND groups.deleted_at IS NULL
    `
    return rows.length > 0
  }

  /**
   * Stores the selection and, when it changed, moves the version. Selecting the group already
   * selected changes nothing. It announces nothing: the handler emits `GroupSelectedEvent`. Runs in
   * the caller's transaction.
   */
  private async storeSelection(userId: number, groupId: string): Promise<SelectedGroup> {
    const changed = (
      await this.sql<SelectionRow[]>`
        INSERT INTO user_settings (user_id, selected_group_id)
        VALUES (${userId}, ${groupId})
        ON CONFLICT (user_id) DO UPDATE
        SET selected_group_id = EXCLUDED.selected_group_id,
            version = user_settings.version + 1,
            updated_at = CURRENT_TIMESTAMP
        WHERE user_settings.selected_group_id IS DISTINCT FROM EXCLUDED.selected_group_id
        RETURNING selected_group_id, version
      `
    )[0]
    if (changed) {
      return { groupId, version: changed.version }
    }
    const current = (
      await this.sql<SelectionRow[]>`
        SELECT selected_group_id, version FROM user_settings WHERE user_id = ${userId}
      `
    )[0]
    return { groupId, version: current.version }
  }

  async create(input: CreateGroupInput, actorId: number): Promise<CreatedGroup> {
    return await this.sql.begin(async (transaction: postgres.TransactionSql) => {
      const repository = new PostgresGroupRepository(transaction)
      return await repository.createInCurrentTransaction(input, actorId)
    })
  }

  async createFirst(input: FirstGroupInput, userId: number): Promise<void> {
    await this.insertFirst(input, userId)
  }

  async ensureFirst(input: FirstGroupInput, userId: number): Promise<void> {
    await this.sql.begin(async (transaction: postgres.TransactionSql) => {
      const repository = new PostgresGroupRepository(transaction)
      // The lock on the user's row serialises two sign-ins of one person, so they cannot both see
      // "no group" and each make one.
      await repository.assertActiveUser(userId)
      if (await repository.hasActiveGroup(userId)) return
      await repository.insertFirst(input, userId)
    })
  }

  private async hasActiveGroup(userId: number): Promise<boolean> {
    const rows = await this.sql`
      SELECT 1
      FROM group_members
      INNER JOIN groups ON groups.id = group_members.group_id AND groups.deleted_at IS NULL
      WHERE group_members.user_id = ${userId}
      LIMIT 1
    `
    return rows.length > 0
  }

  private async insertFirst(input: FirstGroupInput, userId: number): Promise<void> {
    const group = await this.insertGroup(input, userId, false)
    await this.recordChange(group!.id, userId, GROUP_CREATED_EVENT)
  }

  /**
   * Inserts a group and its owner's membership. With `ignoreConflict`, an id already taken gives
   * `null` and writes nothing; without it, a taken id fails the statement, which rolls back the
   * caller's transaction (a sign-up with a taken group id leaves no half-made account).
   */
  private async insertGroup(
    input: { id: string; name: string },
    ownerId: number,
    ignoreConflict: boolean,
  ): Promise<GroupRow | null> {
    const inserted = (
      await this.sql<GroupRow[]>`
        INSERT INTO groups (id, name, owner_user_id, created_by_user_id)
        VALUES (${input.id}, ${input.name}, ${ownerId}, ${ownerId})
        ${ignoreConflict ? this.sql`ON CONFLICT (id) DO NOTHING` : this.sql``}
        RETURNING
          id,
          name,
          owner_user_id,
          created_by_user_id,
          authorization_revision::text AS authorization_revision,
          next_change_sequence::text AS next_change_sequence,
          created_at,
          updated_at,
          deleted_at
      `
    )[0]
    if (!inserted) return null
    await this.sql`
      INSERT INTO group_members (group_id, user_id, role, added_by_user_id)
      VALUES (${inserted.id}, ${ownerId}, ${GroupRole.OWNER}, ${ownerId})
    `
    return inserted
  }

  private async createInCurrentTransaction(
    input: CreateGroupInput,
    actorId: number,
  ): Promise<CreatedGroup> {
    await this.assertActiveUser(actorId)
    const inserted = await this.insertGroup(input, actorId, true)

    if (inserted) {
      await this.sql`
        INSERT INTO audit_events (event_kind, actor_user_id, group_id, request_id)
        VALUES (
          ${GROUP_CREATED_EVENT},
          ${actorId},
          ${inserted.id},
          ${input.requestId || null}
        )
      `
      const sequence = await this.recordChange(inserted.id, actorId, GROUP_CREATED_EVENT)
      return {
        group: toSummary(withStampedSequence(inserted, sequence), GroupRole.OWNER),
        created: true,
      }
    }

    const existing = await this.getForMember(input.id, actorId)
    if (
      existing?.group.createdByUserId === actorId &&
      existing.group.name === input.name &&
      existing.role === GroupRole.OWNER
    ) {
      return {
        group: toSummary(existing.group, existing.role),
        created: false,
      }
    }
    throw new GroupError("ID_ALREADY_EXISTS", "Group id is already in use")
  }

  /**
   * The role checks inside the writes below repeat the handlers' rule (`canRename`, `canDelete` in
   * `@domain/groups`) as the least role the write needs, so a role changed between the handler's
   * read and the write cannot slip through.
   */
  async rename(
    groupId: string,
    name: string,
    actorId: number,
    requestId?: string,
  ): Promise<GroupSummary | null> {
    return await this.sql.begin(async (transaction: postgres.TransactionSql) => {
      const repository = new PostgresGroupRepository(transaction)
      const renamed = (
        await transaction<GroupSummaryRow[]>`
          UPDATE groups
          SET name = ${name}, updated_at = CURRENT_TIMESTAMP
          FROM group_members
          WHERE groups.id = ${groupId}
            AND groups.deleted_at IS NULL
            AND group_members.group_id = groups.id
            AND group_members.user_id = ${actorId}
            AND group_members.role >= ${GroupRole.ADMIN}
          RETURNING
            groups.id,
            groups.name,
            group_members.role,
            groups.authorization_revision::text AS authorization_revision,
            groups.next_change_sequence::text AS change_sequence,
            groups.updated_at
        `
      )[0]
      if (!renamed) return null
      await repository.audit(groupId, actorId, GROUP_RENAMED_EVENT, requestId)
      const sequence = await repository.recordChange(groupId, actorId, GROUP_RENAMED_EVENT)
      return { ...renamed, changeSequence: sequence }
    })
  }

  async softDelete(
    groupId: string,
    actorId: number,
    requestId?: string,
  ): Promise<DeletedGroupSummary | null> {
    return await this.sql.begin(async (transaction: postgres.TransactionSql) => {
      const repository = new PostgresGroupRepository(transaction)
      await repository.lockMembersAndActor(groupId, actorId)
      const group = await repository.lockOwnedGroup(groupId, actorId, false)
      if (!group) return null

      const others = (
        await transaction<{ count: number }[]>`
          SELECT COUNT(*)::int AS count
          FROM group_members
          INNER JOIN groups ON groups.id = group_members.group_id AND groups.deleted_at IS NULL
          WHERE group_members.user_id = ${actorId}
            AND group_members.group_id <> ${groupId}
        `
      )[0]
      if (others.count === 0) {
        throw new GroupError("LAST_GROUP", "A person must keep at least one group")
      }

      const deleted = (
        await transaction<{ deletedAt: Date; updatedAt: Date }[]>`
          UPDATE groups
          SET deleted_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
          WHERE id = ${groupId}
          RETURNING deleted_at, updated_at
        `
      )[0]

      // A member whose only group this was would be left with nowhere to work: they get a new one,
      // as they would at sign-up. The deleted group no longer counts, as the update above is done.
      const stranded = await transaction<MemberRow[]>`
        SELECT group_members.user_id
        FROM group_members
        INNER JOIN users ON users.id = group_members.user_id AND users.deleted_at IS NULL
        WHERE group_members.group_id = ${groupId}
          AND NOT EXISTS (
            SELECT 1
            FROM group_members AS other
            INNER JOIN groups ON groups.id = other.group_id AND groups.deleted_at IS NULL
            WHERE other.user_id = group_members.user_id
          )
        ORDER BY group_members.user_id
      `
      for (const { userId } of stranded) {
        await repository.insertFirst(
          { id: crypto.randomUUID(), name: REPLACEMENT_GROUP_NAME },
          userId,
        )
      }

      await repository.audit(groupId, actorId, GROUP_DELETED_EVENT, requestId)
      const sequence = await repository.recordChange(groupId, actorId, GROUP_DELETED_EVENT, {
        allowDeleted: true,
      })
      return {
        id: groupId,
        name: group.name,
        role: GroupRole.OWNER,
        authorizationRevision: group.authorizationRevision,
        changeSequence: sequence,
        updatedAt: deleted.updatedAt,
        deletedAt: deleted.deletedAt,
      }
    })
  }

  async restore(
    groupId: string,
    actorId: number,
    requestId?: string,
  ): Promise<GroupSummary | null> {
    return await this.sql.begin(async (transaction: postgres.TransactionSql) => {
      const repository = new PostgresGroupRepository(transaction)
      await repository.assertActiveUser(actorId)
      const group = await repository.lockOwnedGroup(groupId, actorId, true)
      if (!group) return null
      const restored = (
        await transaction<{ updatedAt: Date }[]>`
          UPDATE groups
          SET deleted_at = NULL, updated_at = CURRENT_TIMESTAMP
          WHERE id = ${groupId}
          RETURNING updated_at
        `
      )[0]
      await repository.audit(groupId, actorId, GROUP_RESTORED_EVENT, requestId)
      const sequence = await repository.recordChange(groupId, actorId, GROUP_RESTORED_EVENT)
      return {
        id: groupId,
        name: group.name,
        role: GroupRole.OWNER,
        authorizationRevision: group.authorizationRevision,
        changeSequence: sequence,
        updatedAt: restored.updatedAt,
      }
    })
  }

  async listRestorable(userId: number): Promise<DeletedGroupSummary[]> {
    return await this.sql<DeletedGroupSummaryRow[]>`
      SELECT
        groups.id,
        groups.name,
        group_members.role,
        groups.authorization_revision::text AS authorization_revision,
        (groups.next_change_sequence - 1)::text AS change_sequence,
        groups.updated_at,
        groups.deleted_at
      FROM groups
      INNER JOIN group_members
        ON group_members.group_id = groups.id
       AND group_members.user_id = ${userId}
       AND group_members.role = ${GroupRole.OWNER}
      INNER JOIN users ON users.id = group_members.user_id AND users.deleted_at IS NULL
      WHERE groups.deleted_at > now() - make_interval(days => ${GROUP_RESTORE_DAYS})
      ORDER BY groups.deleted_at DESC, groups.id
      LIMIT ${RESTORABLE_LIST_LIMIT}
    `
  }

  async getRestorableForMember(groupId: string, userId: number): Promise<GroupAccess | null> {
    const row = (
      await this.sql<GroupAccessRow[]>`
        SELECT
          groups.id,
          groups.name,
          groups.owner_user_id,
          groups.created_by_user_id,
          groups.authorization_revision::text AS authorization_revision,
          groups.next_change_sequence::text AS next_change_sequence,
          groups.created_at,
          groups.updated_at,
          groups.deleted_at,
          group_members.role
        FROM groups
        INNER JOIN group_members
          ON group_members.group_id = groups.id
         AND group_members.user_id = ${userId}
        INNER JOIN users
          ON users.id = group_members.user_id
         AND users.deleted_at IS NULL
        WHERE groups.id = ${groupId}
          AND groups.deleted_at > now() - make_interval(days => ${GROUP_RESTORE_DAYS})
        LIMIT 1
      `
    )[0]
    return row ? { group: toGroup(row), role: row.role } : null
  }

  /**
   * Locks the rows of the actor and of every member of the group, in id order, so two deletions
   * that touch the same people wait for each other instead of each leaving them a group the other
   * deletes. Id order keeps two such waits from deadlocking.
   */
  private async lockMembersAndActor(groupId: string, actorId: number): Promise<void> {
    const locked = await this.sql<ActiveUserRow[]>`
      SELECT users.id
      FROM users
      WHERE users.deleted_at IS NULL
        AND (
          users.id = ${actorId}
          OR users.id IN (SELECT user_id FROM group_members WHERE group_id = ${groupId})
        )
      ORDER BY users.id
      FOR NO KEY UPDATE
    `
    if (!locked.some((user) => user.id === actorId)) {
      throw new GroupError("USER_NOT_ACTIVE", "User is not active")
    }
  }

  /**
   * Locks the group row when `actorId` owns it: an active group, or with `restorable` a group
   * deleted inside the restore window. `null` when it is neither, or the actor is not its owner.
   */
  private async lockOwnedGroup(
    groupId: string,
    actorId: number,
    restorable: boolean,
  ): Promise<{ name: string; authorizationRevision: string } | null> {
    const row = (
      await this.sql<{ name: string; authorizationRevision: string }[]>`
        SELECT groups.name, groups.authorization_revision::text AS authorization_revision
        FROM groups
        INNER JOIN group_members
          ON group_members.group_id = groups.id
         AND group_members.user_id = ${actorId}
         AND group_members.role = ${GroupRole.OWNER}
        WHERE groups.id = ${groupId}
          AND ${
        restorable
          ? this.sql`groups.deleted_at > now() - make_interval(days => ${GROUP_RESTORE_DAYS})`
          : this.sql`groups.deleted_at IS NULL`
      }
        FOR NO KEY UPDATE OF groups
      `
    )[0]
    return row ?? null
  }

  /** Writes one audit row in the current transaction. It outlives the group (see the purge). */
  private async audit(
    groupId: string,
    actorId: number,
    eventKind: string,
    requestId: string | undefined,
  ): Promise<void> {
    await this.sql`
      INSERT INTO audit_events (event_kind, actor_user_id, group_id, request_id)
      VALUES (${eventKind}, ${actorId}, ${groupId}, ${requestId || null})
    `
  }

  /** Records a change on a group in the current transaction; see {@link recordGroupChange}. */
  private async recordChange(
    groupId: string,
    actorId: number,
    eventKind: string,
    options: { allowDeleted?: boolean } = {},
  ): Promise<string> {
    return await recordGroupChange(this.sql, groupId, actorId, eventKind, options)
  }

  private async assertActiveUser(userId: number): Promise<void> {
    const active = (
      await this.sql<ActiveUserRow[]>`
        SELECT users.id
        FROM users
        WHERE users.id = ${userId}
          AND users.deleted_at IS NULL
        FOR UPDATE
      `
    )[0]
    if (!active) {
      throw new GroupError("USER_NOT_ACTIVE", "User is not active")
    }
  }
}

function toGroup(row: GroupRow): Group {
  return {
    id: row.id,
    name: row.name,
    ownerUserId: row.ownerUserId,
    createdByUserId: row.createdByUserId,
    authorizationRevision: row.authorizationRevision,
    nextChangeSequence: row.nextChangeSequence,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    deletedAt: row.deletedAt,
  }
}

/** The row as it reads after `recordChange` took `sequence`: the next one is one past it. */
function withStampedSequence(row: GroupRow, sequence: string): GroupRow {
  return { ...row, nextChangeSequence: (BigInt(sequence) + 1n).toString() }
}

function toSummary(
  group: Pick<Group, "id" | "name" | "authorizationRevision" | "nextChangeSequence" | "updatedAt">,
  role: GroupRole,
): GroupSummary {
  return {
    id: group.id,
    name: group.name,
    role,
    authorizationRevision: group.authorizationRevision,
    changeSequence: (BigInt(group.nextChangeSequence) - 1n).toString(),
    updatedAt: group.updatedAt,
  }
}
