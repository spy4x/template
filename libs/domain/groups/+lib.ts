import type { Command, Query } from "@spy4x/platform/cqrs"
import type { Actor } from "@domain/identity"

/**
 * The aggregate a group's changes are recorded and announced under: the `aggregate_type` of its
 * outbox rows (whose `aggregate_version` is the change's sequence) and the `aggregate` of its
 * `change.hint`.
 */
export const GROUP_AGGREGATE = "group"

/**
 * How long a deleted group can be restored. After this many days the worker removes the group and
 * its data for good, and the group is gone for its owner too.
 */
export const GROUP_RESTORE_DAYS = 30

export enum GroupRole {
  VIEWER = 1,
  EDITOR = 2,
  ADMIN = 3,
  OWNER = 4,
}

export type GroupErrorCode =
  | "GROUP_NOT_FOUND"
  | "ID_ALREADY_EXISTS"
  | "INVALID_CURSOR"
  | "INVALID_REQUEST"
  | "LAST_GROUP"
  | "LAST_OWNER"
  | "ROLE_INSUFFICIENT"
  | "USER_NOT_ACTIVE"

export class GroupError extends Error {
  constructor(
    public readonly code: GroupErrorCode,
    message: string,
  ) {
    super(message)
    this.name = "GroupError"
  }
}

export interface Group {
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

export interface GroupMembership {
  groupId: string
  userId: number
  role: GroupRole
  addedByUserId: number
  createdAt: Date
  updatedAt: Date
}

export interface GroupSummary {
  id: string
  name: string
  role: GroupRole
  authorizationRevision: string
  /**
   * The sequence of the last change committed to the group, as a decimal string (BIGINT). A client
   * that holds a group at this sequence has seen every change up to now; it is the number a pull
   * moves the client's cursor to.
   */
  changeSequence: string
  updatedAt: Date
}

/** A deleted group its owner can still restore; `deletedAt` is when it was deleted. */
export interface DeletedGroupSummary extends GroupSummary {
  deletedAt: Date
}

export interface GroupAccess {
  group: Group
  role: GroupRole
}

export interface CreateGroupRequest {
  id: string
  name: string
}

export interface CreateGroupInput {
  id: string
  name: string
  requestId?: string
}

/** The first group a person gets, when they sign up or when they somehow have none. */
export interface FirstGroupInput {
  id: string
  name: string
}

export interface CreatedGroup {
  group: GroupSummary
  created: boolean
}

export interface GroupListPageKey {
  updatedAt: Date
  id: string
}

export interface GroupListPage {
  limit: number
  after?: GroupListPageKey
}

export interface GroupListResult {
  groups: GroupSummary[]
  nextPageKey: GroupListPageKey | null
}

export interface GroupCreatePayload {
  actor: Actor
  id: string
  name: string
  requestId?: string
  /** Makes a retry of this command safe; see the idempotency middleware on the command bus. */
  idempotencyKey?: string
}

export type GroupCreateResult = CreatedGroup

export class GroupCreateCommand implements Command<GroupCreatePayload, GroupCreateResult> {
  __resultType?: GroupCreateResult
  constructor(public data: GroupCreatePayload) {}
}

export interface GroupRenamePayload {
  actor: Actor
  groupId: string
  name: string
  requestId?: string
  /** Makes a retry of this command safe; see the idempotency middleware on the command bus. */
  idempotencyKey?: string
}

/**
 * Renames a group. An admin or the owner may; a viewer or editor is refused with
 * `ROLE_INSUFFICIENT`, and a non-member is told `GROUP_NOT_FOUND`.
 */
export class GroupRenameCommand implements Command<GroupRenamePayload, { group: GroupSummary }> {
  __resultType?: { group: GroupSummary }
  constructor(public data: GroupRenamePayload) {}
}

export interface GroupDeletePayload {
  actor: Actor
  groupId: string
  requestId?: string
  /** Makes a retry of this command safe; see the idempotency middleware on the command bus. */
  idempotencyKey?: string
}

/**
 * Soft-deletes a group: it is hidden from every member and its owner can restore it for
 * {@link GROUP_RESTORE_DAYS} days. Only the owner may. The actor's last group is refused with
 * `LAST_GROUP`.
 */
export class GroupDeleteCommand
  implements Command<GroupDeletePayload, { group: DeletedGroupSummary }> {
  __resultType?: { group: DeletedGroupSummary }
  constructor(public data: GroupDeletePayload) {}
}

export interface GroupRestorePayload {
  actor: Actor
  groupId: string
  requestId?: string
  /** Makes a retry of this command safe; see the idempotency middleware on the command bus. */
  idempotencyKey?: string
}

/**
 * Brings back a group deleted less than {@link GROUP_RESTORE_DAYS} days ago, with all its data.
 * Only the owner may; an older or never-deleted group answers `GROUP_NOT_FOUND`.
 */
export class GroupRestoreCommand implements Command<GroupRestorePayload, { group: GroupSummary }> {
  __resultType?: { group: GroupSummary }
  constructor(public data: GroupRestorePayload) {}
}

export interface GroupDeletedListPayload {
  actor: Actor
}

/** The groups the actor owns that can still be restored, most recently deleted first. */
export class GroupDeletedListQuery
  implements Query<GroupDeletedListPayload, { groups: DeletedGroupSummary[] }> {
  __resultType?: { groups: DeletedGroupSummary[] }
  constructor(public data: GroupDeletedListPayload) {}
}

export interface GroupListPayload {
  actor: Actor
  page: GroupListPage
}

export class GroupListQuery implements Query<GroupListPayload, GroupListResult> {
  __resultType?: GroupListResult
  constructor(public data: GroupListPayload) {}
}

export interface GroupGetPayload {
  actor: Actor
  groupId: string
}

export type GroupGetResult = { group: GroupSummary }

/** One group of the actor, as the list shows it. Throws `GROUP_NOT_FOUND` for a non-member. */
export class GroupGetQuery implements Query<GroupGetPayload, GroupGetResult> {
  __resultType?: GroupGetResult
  constructor(public data: GroupGetPayload) {}
}

/**
 * Which group the person works in now: the one `/notes` shows. One per user, kept on the server so
 * every device agrees. `groupId` is `null` only for a person who belongs to no group.
 */
export interface SelectedGroup {
  groupId: string | null
  /**
   * Grows by one every time the selection changes; `0` while the person never chose and the
   * answer is the fallback.
   */
  version: number
}

export interface GroupSelectPayload {
  actor: Actor
  groupId: string
  requestId?: string
  /** Makes a retry of this command safe; see the idempotency middleware on the command bus. */
  idempotencyKey?: string
}

/**
 * Selects one of the actor's groups. A group the actor is not a member of answers
 * `GROUP_NOT_FOUND`, as a missing group does.
 */
export class GroupSelectCommand implements Command<GroupSelectPayload, SelectedGroup> {
  __resultType?: SelectedGroup
  constructor(public data: GroupSelectPayload) {}
}

export interface GroupSelectedPayload {
  actor: Actor
}

/**
 * The actor's selected group. When the stored one is gone (the group was deleted, or the person
 * left it) or never chosen, the answer is another of their groups, the oldest one: the server
 * decides, so every device gets the same answer. A deleted group is never the answer.
 */
export class GroupSelectedQuery implements Query<GroupSelectedPayload, SelectedGroup> {
  __resultType?: SelectedGroup
  constructor(public data: GroupSelectedPayload) {}
}

export interface GroupRepository {
  /** See {@link GroupSelectedQuery}. */
  getSelected(userId: number): Promise<SelectedGroup>
  /**
   * Stores the user's selection, in one transaction. `null` when the user is not a member of the
   * group (or it is missing): nothing is stored. The repository announces nothing: the handler
   * emits `GroupSelectedEvent`, which tells the user's other devices.
   */
  select(userId: number, groupId: string): Promise<SelectedGroup | null>
  listForUser(userId: number, page: GroupListPage): Promise<GroupListResult>
  /** The group as the list shows it, or `null` when it is missing or the user is not a member. */
  getSummaryForMember(groupId: string, userId: number): Promise<GroupSummary | null>
  /**
   * The ids of the active users who are members of a group, deleted or not; who a change is pushed
   * to. A deleted group counts, so the hint of its deletion (and of its restore) reaches the members
   * whose page still shows it.
   */
  listMemberUserIds(groupId: string): Promise<number[]>
  /** The actor's access to an active group, or `null` for a missing, deleted or foreign group. */
  getForMember(groupId: string, userId: number): Promise<GroupAccess | null>
  /**
   * The actor's access to a group deleted less than {@link GROUP_RESTORE_DAYS} days ago, or `null`
   * for any other group: active, purged, older or not theirs.
   */
  getRestorableForMember(groupId: string, userId: number): Promise<GroupAccess | null>
  create(input: CreateGroupInput, actorId: number): Promise<CreatedGroup>
  /**
   * Creates the person's first group in the caller's transaction, as sign-up does. The group is an
   * ordinary one: the person owns it, and it follows every rule other groups follow.
   */
  createFirst(input: FirstGroupInput, userId: number): Promise<void>
  /**
   * Gives a person with no active group one, in its own transaction; does nothing for a person who
   * has a group. Sign-in calls it, so an account always has somewhere to work.
   */
  ensureFirst(input: FirstGroupInput, userId: number): Promise<void>
  /** Renames the group and announces the change. `null` when it is missing or deleted. */
  rename(
    groupId: string,
    name: string,
    actorId: number,
    requestId?: string,
  ): Promise<GroupSummary | null>
  /**
   * Soft-deletes the group, in one transaction: refuses with `LAST_GROUP` when it is the actor's
   * only active group; gives every other member who would be left with no group a new one; and
   * announces the change. `null` when the group is missing or already deleted.
   */
  softDelete(
    groupId: string,
    actorId: number,
    requestId?: string,
  ): Promise<DeletedGroupSummary | null>
  /** Brings a group back inside its restore window. `null` when it is not restorable. */
  restore(groupId: string, actorId: number, requestId?: string): Promise<GroupSummary | null>
  /** The groups the user owns that can still be restored, most recently deleted first. */
  listRestorable(userId: number): Promise<DeletedGroupSummary[]>
}

const UUID_V4_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
const GROUP_ID_KEYS = ["groupId"]
const CREATE_KEYS = ["id", "name"]
const RENAME_BODY_KEYS = ["name"]
const RENAME_KEYS = ["groupId", "name"]

function hasExactKeys(value: unknown, keys: string[]): value is Record<string, unknown> {
  return isRecord(value) && Object.keys(value).sort().join(",") === keys.join(",")
}

/** A group name from a request: trimmed, 1 to 100 characters. */
export function parseGroupName(value: unknown): string {
  if (typeof value !== "string") {
    throw new GroupError("INVALID_REQUEST", "Group name must be a string")
  }
  const name = value.trim()
  const nameLength = Array.from(name).length
  if (nameLength < 1 || nameLength > 100) {
    throw new GroupError("INVALID_REQUEST", "Group name must contain 1 to 100 characters")
  }
  return name
}

export function parseCreateGroupRequest(value: unknown): CreateGroupRequest {
  // TODO(remove after the first release that ships this change): a page cached before the deploy
  // still posts `kind: 2`. It is accepted and ignored for one release, so those pages can still
  // create groups; then delete these two lines and the test that names them.
  const { kind, ...rest } = isRecord(value) ? value : { kind: undefined }
  const request = kind === 2 ? rest : value
  if (!hasExactKeys(request, CREATE_KEYS)) {
    throw new GroupError("INVALID_REQUEST", "Expected exactly id and name")
  }
  return { id: parseGroupId(request.id), name: parseGroupName(request.name) }
}

/** The body of a rename over REST, where the path names the group: exactly `{ name }`. */
export function parseRenameGroupBody(value: unknown): { name: string } {
  if (!hasExactKeys(value, RENAME_BODY_KEYS)) {
    throw new GroupError("INVALID_REQUEST", "Expected exactly name")
  }
  return { name: parseGroupName(value.name) }
}

/** The payload of a rename over the socket: exactly `{ groupId, name }`. */
export function parseRenameGroupRequest(value: unknown): { groupId: string; name: string } {
  if (!hasExactKeys(value, RENAME_KEYS)) {
    throw new GroupError("INVALID_REQUEST", "Expected exactly groupId and name")
  }
  return { groupId: parseGroupId(value.groupId), name: parseGroupName(value.name) }
}

/**
 * The body of a request that names one group (select, delete, restore): exactly `{ groupId }`, a
 * lowercase UUID v4.
 */
export function parseGroupIdRequest(value: unknown): { groupId: string } {
  if (!hasExactKeys(value, GROUP_ID_KEYS)) {
    throw new GroupError("INVALID_REQUEST", "Expected exactly groupId")
  }
  return { groupId: parseGroupId(value.groupId) }
}

/** A group id from a request: a lowercase UUID v4, or `INVALID_REQUEST`. */
export function parseGroupId(value: unknown): string {
  if (typeof value !== "string" || !UUID_V4_PATTERN.test(value)) {
    throw new GroupError("INVALID_REQUEST", "Group id must be a lowercase UUID v4")
  }
  return value
}

export function canRead(role: GroupRole): boolean {
  return isGroupRole(role)
}

export function canMutateNotes(role: GroupRole): boolean {
  return isGroupRole(role) && role >= GroupRole.EDITOR
}

export function canManageMember(
  actor: GroupRole,
  target: GroupRole,
  next?: GroupRole,
): boolean {
  if (!isGroupRole(actor) || !isGroupRole(target) || (next !== undefined && !isGroupRole(next))) {
    return false
  }
  if (actor === GroupRole.OWNER) {
    return true
  }
  if (actor !== GroupRole.ADMIN || target > GroupRole.EDITOR) {
    return false
  }
  return next === undefined || next <= GroupRole.EDITOR
}

/**
 * Whether `role` may rename the group: an admin or the owner. Every group follows the same rule.
 */
export function canRename(role: GroupRole): boolean {
  return isGroupRole(role) && role >= GroupRole.ADMIN
}

/** Whether `role` may delete or restore the group: only the owner. */
export function canDelete(role: GroupRole): boolean {
  return isGroupRole(role) && role === GroupRole.OWNER
}

/**
 * Throws unless `role` may rename the group. `null` means the actor is not a member, which answers
 * "group not found" so a stranger cannot tell a group exists.
 */
export function assertCanRename(role: GroupRole | null): void {
  if (role === null || !canRead(role)) throw new GroupError("GROUP_NOT_FOUND", "Group not found")
  if (!canRename(role)) {
    throw new GroupError("ROLE_INSUFFICIENT", "Only an admin or the owner can rename a group")
  }
}

/** Throws unless `role` may delete or restore the group: only the owner. See {@link assertCanRename}. */
export function assertCanDelete(role: GroupRole | null): void {
  if (role === null || !canRead(role)) throw new GroupError("GROUP_NOT_FOUND", "Group not found")
  if (!canDelete(role)) {
    throw new GroupError("ROLE_INSUFFICIENT", "Only the owner can delete or restore a group")
  }
}

export function assertOwnerRemains(ownerCount: number): void {
  if (ownerCount < 1) {
    throw new GroupError("LAST_OWNER", "A shared group must retain an owner")
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function isGroupRole(role: GroupRole): boolean {
  return Number.isInteger(role) && role >= GroupRole.VIEWER && role <= GroupRole.OWNER
}
