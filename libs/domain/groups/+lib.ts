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
  userId: number
  id: string
  kind: GroupKind.SHARED
  name: string
  requestId?: string
}

export type GroupCreateResult = CreatedGroup

export class GroupCreateCommand implements Command<GroupCreatePayload, GroupCreateResult> {
  __resultType?: GroupCreateResult
  constructor(public data: GroupCreatePayload) {}
}

export interface GroupListPayload {
  userId: number
  page: GroupListPage
}

export class GroupListQuery implements Query<GroupListPayload, GroupListResult> {
  __resultType?: GroupListResult
  constructor(public data: GroupListPayload) {}
}

export interface GroupRepository {
  listForUser(userId: number, page: GroupListPage): Promise<GroupListResult>
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
import type { Command, Query } from "@platform/cqrs/types.ts"
