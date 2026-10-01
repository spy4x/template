import type { Command, Query } from "@spy4x/platform/cqrs"
import type { Actor } from "@domain/identity"

/**
 * The aggregate a group's changes are recorded and announced under: the `aggregate_type` of its
 * outbox rows (whose `aggregate_version` is the change's sequence) and the `aggregate` of its
 * `change.hint`.
 */
export const GROUP_AGGREGATE = "group"

export enum GroupKind {
  PERSONAL = 1,
  SHARED = 2,
}

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
  | "LAST_OWNER"
  | "PERSONAL_GROUP_IMMUTABLE"
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
  kind: GroupKind
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

export interface GroupAccess {
  group: Group
  role: GroupRole
}

export interface CreateSharedGroupRequest {
  id: string
  kind: GroupKind.SHARED
  name: string
}

export interface CreateSharedGroupInput {
  id: string
  name: string
  requestId?: string
}

export interface CreatePersonalGroupInput {
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
  kind: GroupKind.SHARED
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
 * left it) or never chosen, the answer is another of their groups, their personal one first, and
 * it is stored: the server decides, so every device gets the same answer.
 */
export class GroupSelectedQuery implements Query<GroupSelectedPayload, SelectedGroup> {
  __resultType?: SelectedGroup
  constructor(public data: GroupSelectedPayload) {}
}

export interface GroupRepository {
  /** See {@link GroupSelectedQuery}. */
  getSelected(userId: number): Promise<SelectedGroup>
  /**
   * Stores the user's selection and announces it to their devices, in one transaction. `null` when
   * the user is not a member of the group (or it is missing): nothing is stored.
   */
  select(userId: number, groupId: string): Promise<SelectedGroup | null>
  listForUser(userId: number, page: GroupListPage): Promise<GroupListResult>
  /** The group as the list shows it, or `null` when it is missing or the user is not a member. */
  getSummaryForMember(groupId: string, userId: number): Promise<GroupSummary | null>
  /** The ids of the active users who are members of an active group; who a change is pushed to. */
  listMemberUserIds(groupId: string): Promise<number[]>
  getForMember(groupId: string, userId: number): Promise<GroupAccess | null>
  createShared(input: CreateSharedGroupInput, actorId: number): Promise<CreatedGroup>
  createPersonal(input: CreatePersonalGroupInput, userId: number): Promise<Group>
  ensurePersonal(input: CreatePersonalGroupInput, userId: number): Promise<Group>
}

export type PersonalGroupOperation =
  | "delete"
  | "invite"
  | "manual-create"
  | "remove-owner"
  | "transfer-owner"

const UUID_V4_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
const SELECT_KEYS = ["groupId"]
const CREATE_SHARED_KEYS = ["id", "kind", "name"]

export function parseCreateSharedGroupRequest(value: unknown): CreateSharedGroupRequest {
  if (!isRecord(value) || Object.keys(value).sort().join(",") !== CREATE_SHARED_KEYS.join(",")) {
    throw new GroupError("INVALID_REQUEST", "Expected exactly id, kind, and name")
  }
  if (typeof value.id !== "string" || !UUID_V4_PATTERN.test(value.id)) {
    throw new GroupError("INVALID_REQUEST", "Group id must be a lowercase UUID v4")
  }
  if (value.kind !== GroupKind.SHARED) {
    throw new GroupError("INVALID_REQUEST", "Only shared groups can be created")
  }
  if (typeof value.name !== "string") {
    throw new GroupError("INVALID_REQUEST", "Group name must be a string")
  }
  const name = value.name.trim()
  const nameLength = Array.from(name).length
  if (nameLength < 1 || nameLength > 100) {
    throw new GroupError("INVALID_REQUEST", "Group name must contain 1 to 100 characters")
  }
  return { id: value.id, kind: GroupKind.SHARED, name }
}

/** The body of a request to select a group: exactly `{ groupId }`, a lowercase UUID v4. */
export function parseSelectGroupRequest(value: unknown): { groupId: string } {
  if (!isRecord(value) || Object.keys(value).sort().join(",") !== SELECT_KEYS.join(",")) {
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

export function assertPersonalInvariant(
  group: Pick<Group, "kind">,
  operation: PersonalGroupOperation,
): void {
  if (group.kind === GroupKind.PERSONAL) {
    throw new GroupError(
      "PERSONAL_GROUP_IMMUTABLE",
      `Personal group does not allow ${operation}`,
    )
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
