import type postgres from "postgres"
import {
  CreatedGroup,
  CreatePersonalGroupInput,
  CreateSharedGroupInput,
  Group,
  GroupAccess,
  GroupError,
  GroupKind,
  GroupListPage,
  GroupListResult,
  GroupRepository,
  GroupRole,
  GroupSummary,
} from "@domain/groups"

interface GroupRow extends postgres.Row {
  id: string
  kind: GroupKind
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
  kind: GroupKind
  name: string
  role: GroupRole
  authorizationRevision: string
  updatedAt: Date
}

interface ActiveUserRow extends postgres.Row {
  id: number
}

const GROUP_CREATED_EVENT = "group.created"
const GROUP_AGGREGATE = "group"

export class PostgresGroupRepository implements GroupRepository {
  constructor(private readonly sql: postgres.Sql) {}

  async listForUser(userId: number, page: GroupListPage): Promise<GroupListResult> {
    const limit = Math.max(1, Math.min(100, page.limit))
    const rows = await this.sql<GroupSummaryRow[]>`
      SELECT
        groups.id,
        groups.kind,
        groups.name,
        group_members.role,
        groups.authorization_revision::text AS authorization_revision,
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

  async getForMember(groupId: string, userId: number): Promise<GroupAccess | null> {
    const row = (
      await this.sql<GroupAccessRow[]>`
        SELECT
          groups.id,
          groups.kind,
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

  async createShared(
    input: CreateSharedGroupInput,
    actorId: number,
  ): Promise<CreatedGroup> {
    return await this.sql.begin(async (transaction: postgres.TransactionSql) => {
      const repository = new PostgresGroupRepository(transaction)
      return await repository.createSharedInCurrentTransaction(input, actorId)
    })
  }

  async createPersonal(input: CreatePersonalGroupInput, userId: number): Promise<Group> {
    const group = (
      await this.sql<GroupRow[]>`
        INSERT INTO groups (
          id,
          kind,
          name,
          owner_user_id,
          created_by_user_id
        ) VALUES (
          ${input.id},
          ${GroupKind.PERSONAL},
          ${input.name},
          ${userId},
          ${userId}
        )
        RETURNING
          id,
          kind,
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
    if (!group) {
      throw new Error("Personal group insert returned no row")
    }
    await this.sql`
      INSERT INTO group_members (group_id, user_id, role, added_by_user_id)
      VALUES (${group.id}, ${userId}, ${GroupRole.OWNER}, ${userId})
    `
    return toGroup(group)
  }

  async ensurePersonal(input: CreatePersonalGroupInput, userId: number): Promise<Group> {
    return await this.sql.begin(async (transaction: postgres.TransactionSql) => {
      const repository = new PostgresGroupRepository(transaction)
      await repository.assertActiveUser(userId)
      const existing = await repository.getPersonalForOwner(userId)
      if (existing) {
        return existing
      }

      const inserted = (
        await transaction<GroupRow[]>`
          INSERT INTO groups (id, kind, name, owner_user_id, created_by_user_id)
          VALUES (${input.id}, ${GroupKind.PERSONAL}, ${input.name}, ${userId}, ${userId})
          ON CONFLICT (owner_user_id) WHERE kind = 1 AND deleted_at IS NULL DO NOTHING
          RETURNING
            id,
            kind,
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
      if (inserted) {
        await transaction`
          INSERT INTO group_members (group_id, user_id, role, added_by_user_id)
          VALUES (${inserted.id}, ${userId}, ${GroupRole.OWNER}, ${userId})
        `
        return toGroup(inserted)
      }

      const concurrent = await repository.getPersonalForOwner(userId)
      if (!concurrent) {
        throw new Error("Personal group conflict resolved without an accessible group")
      }
      return concurrent
    })
  }

  private async createSharedInCurrentTransaction(
    input: CreateSharedGroupInput,
    actorId: number,
  ): Promise<CreatedGroup> {
    await this.assertActiveUser(actorId)
    const inserted = (
      await this.sql<GroupRow[]>`
        INSERT INTO groups (
          id,
          kind,
          name,
          owner_user_id,
          created_by_user_id
        ) VALUES (
          ${input.id},
          ${GroupKind.SHARED},
          ${input.name},
          ${actorId},
          ${actorId}
        )
        ON CONFLICT (id) DO NOTHING
        RETURNING
          id,
          kind,
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

    if (inserted) {
      await this.sql`
        INSERT INTO group_members (group_id, user_id, role, added_by_user_id)
        VALUES (${inserted.id}, ${actorId}, ${GroupRole.OWNER}, ${actorId})
      `
      await this.sql`
        INSERT INTO audit_events (event_kind, actor_user_id, group_id, request_id)
        VALUES (
          ${GROUP_CREATED_EVENT},
          ${actorId},
          ${inserted.id},
          ${input.requestId || null}
        )
      `
      await this.sql`
        INSERT INTO outbox_events (
          id,
          event_kind,
          aggregate_type,
          aggregate_id,
          aggregate_version,
          group_id,
          actor_user_id
        ) VALUES (
          ${crypto.randomUUID()},
          ${GROUP_CREATED_EVENT},
          ${GROUP_AGGREGATE},
          ${inserted.id},
          1,
          ${inserted.id},
          ${actorId}
        )
      `
      return {
        group: toSummary(inserted, GroupRole.OWNER),
        created: true,
      }
    }

    const existing = await this.getForMember(input.id, actorId)
    if (
      existing?.group.kind === GroupKind.SHARED &&
      existing.group.createdByUserId === actorId &&
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

  private async getPersonalForOwner(userId: number): Promise<Group | null> {
    const row = (
      await this.sql<GroupAccessRow[]>`
        SELECT
          groups.id,
          groups.kind,
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
         AND group_members.role = ${GroupRole.OWNER}
        INNER JOIN users
          ON users.id = group_members.user_id
         AND users.deleted_at IS NULL
        WHERE groups.owner_user_id = ${userId}
          AND groups.kind = ${GroupKind.PERSONAL}
          AND groups.deleted_at IS NULL
        LIMIT 1
      `
    )[0]
    return row ? toGroup(row) : null
  }
}

function toGroup(row: GroupRow): Group {
  return {
    id: row.id,
    kind: row.kind,
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

function toSummary(
  group: Pick<Group, "id" | "kind" | "name" | "authorizationRevision" | "updatedAt">,
  role: GroupRole,
): GroupSummary {
  return {
    id: group.id,
    kind: group.kind,
    name: group.name,
    role,
    authorizationRevision: group.authorizationRevision,
    updatedAt: group.updatedAt,
  }
}
