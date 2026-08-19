import type { CreatePersonalGroupInput, Group } from "@domain/groups"
import {
  SessionMFAStatus,
  User,
  UserBase,
  UserKey,
  UserKeyKind,
  UserMFAStatus,
  UserRole,
  UserSession,
  UserSessionBase,
} from "@shared/types"
import type { AuthData } from "./types.ts"

export interface PasswordSignupTransaction {
  user: {
    createOne(params: { data: UserBase }): Promise<User>
  }
  userKey: {
    findOne(params: {
      kind: UserKeyKind
      identification: string
    }): Promise<UserKey | null>
    createOne(params: {
      userId: number
      kind: UserKeyKind
      identification: string
      secret: string
    }): Promise<UserKey>
  }
  group: {
    createPersonal(input: CreatePersonalGroupInput, userId: number): Promise<Group>
  }
}

export interface PasswordSignupStore<TTransaction extends PasswordSignupTransaction> {
  begin<T>(fn: (transaction: TTransaction) => Promise<T>): Promise<T>
}

export interface PasswordSignupInput {
  username: string
  passwordHash: string
  personalGroupId: string
}

export type PasswordSignupStep = "user" | "key" | "personal-group" | "session"

export class PasswordSignupPersistenceError extends Error {
  constructor(step: string) {
    super(`Password signup ${step} insert returned no row`)
    this.name = "PasswordSignupPersistenceError"
  }
}

export function normalizeUsername(username: string): string {
  return username.trim().toLowerCase()
}

export async function persistPasswordSignup<TTransaction extends PasswordSignupTransaction>(
  store: PasswordSignupStore<TTransaction>,
  input: PasswordSignupInput,
  createSession: (
    session: Pick<UserSessionBase, "userId" | "keyId" | "mfa">,
    transaction: TTransaction,
  ) => Promise<UserSession | null>,
  afterStep?: (step: PasswordSignupStep) => void | Promise<void>,
): Promise<AuthData | null> {
  const username = normalizeUsername(input.username)
  if (Array.from(username).length < 1 || Array.from(username).length > 50) {
    return null
  }
  try {
    return await store.begin(async (transaction) => {
      const existingKey = await transaction.userKey.findOne({
        kind: UserKeyKind.USERNAME_PASSWORD,
        identification: username,
      })
      if (existingKey) {
        return null
      }

      const user = await transaction.user.createOne({
        data: {
          firstName: "",
          lastName: "",
          mfa: UserMFAStatus.NOT_CONFIGURED,
          role: UserRole.VIEWER,
          lastLoginAt: new Date(),
        },
      })
      if (!user) {
        throw new PasswordSignupPersistenceError("user")
      }
      await afterStep?.("user")

      const key = await transaction.userKey.createOne({
        userId: user.id,
        kind: UserKeyKind.USERNAME_PASSWORD,
        identification: username,
        secret: input.passwordHash,
      })
      if (!key) {
        throw new PasswordSignupPersistenceError("key")
      }
      await afterStep?.("key")

      await transaction.group.createPersonal(
        { id: input.personalGroupId, name: "Personal" },
        user.id,
      )
      await afterStep?.("personal-group")

      const session = await createSession({
        userId: user.id,
        keyId: key.id,
        mfa: SessionMFAStatus.NOT_REQUIRED,
      }, transaction)
      if (!session) {
        throw new PasswordSignupPersistenceError("session")
      }
      await afterStep?.("session")

      return { user, key, session }
    })
  } catch (error) {
    if (isUsernameConflict(error)) {
      return null
    }
    throw error
  }
}

function isUsernameConflict(error: unknown): boolean {
  if (typeof error !== "object" || error === null) {
    return false
  }
  const postgresError = error as { code?: unknown; constraint_name?: unknown }
  return postgresError.code === "23505" &&
    postgresError.constraint_name === "idx_user_keys_kind_identification"
}
