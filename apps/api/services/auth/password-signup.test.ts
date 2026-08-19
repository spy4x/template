import { expect } from "@std/expect"
import { describe, it } from "@std/testing/bdd"
import { GroupKind } from "@domain/groups"
import {
  SessionMFAStatus,
  UserKeyKind,
  UserMFAStatus,
  UserRole,
  UserSessionStatus,
} from "@domain/identity"
import {
  normalizeUsername,
  PasswordSignupPersistenceError,
  PasswordSignupStep,
  PasswordSignupStore,
  PasswordSignupTransaction,
  persistPasswordSignup,
} from "./password-signup.ts"

const now = new Date("2026-08-18T10:00:00.000Z")
const personalGroupId = "7b6d8d6c-1af5-4f04-8ae4-b1ee5d111001"

function buildFixture() {
  const calls: string[] = []
  let committed = false
  const transaction: PasswordSignupTransaction = {
    user: {
      createOne() {
        calls.push("user")
        return Promise.resolve({
          id: 10,
          firstName: "",
          lastName: "",
          role: UserRole.VIEWER,
          mfa: UserMFAStatus.NOT_CONFIGURED,
          lastLoginAt: now,
          createdAt: now,
          updatedAt: now,
          deletedAt: null,
        })
      },
    },
    userKey: {
      findOne() {
        calls.push("find-key")
        return Promise.resolve(null)
      },
      createOne() {
        calls.push("key")
        return Promise.resolve({
          id: 20,
          userId: 10,
          kind: UserKeyKind.USERNAME_PASSWORD,
          identification: "user",
          secret: "hash",
          createdAt: now,
          updatedAt: now,
          deletedAt: null,
        })
      },
    },
    group: {
      createPersonal(input, userId) {
        calls.push("group-member")
        return Promise.resolve({
          id: input.id,
          kind: GroupKind.PERSONAL,
          name: input.name,
          ownerUserId: userId,
          createdByUserId: userId,
          authorizationRevision: "1",
          nextChangeSequence: "1",
          createdAt: now,
          updatedAt: now,
          deletedAt: null,
        })
      },
    },
  }
  const store: PasswordSignupStore<PasswordSignupTransaction> = {
    async begin(fn) {
      const result = await fn(transaction)
      committed = true
      return result
    },
  }
  return { calls, store, transaction, wasCommitted: () => committed }
}

describe("password signup persistence", () => {
  it("normalizes username before every lookup and insert", async () => {
    expect(normalizeUsername("  USER  ")).toBe("user")
    const fixture = buildFixture()
    let identification = ""
    fixture.transaction.userKey.findOne = (params) => {
      identification = params.identification
      return Promise.resolve(null)
    }
    await persistPasswordSignup(
      fixture.store,
      { username: "  USER  ", passwordHash: "hash", personalGroupId },
      () => Promise.resolve(null),
    ).catch(() => undefined)
    expect(identification).toBe("user")
  })

  it("uses one transaction for user, key, personal group/member, and session", async () => {
    const fixture = buildFixture()
    const result = await persistPasswordSignup(
      fixture.store,
      { username: "user", passwordHash: "hash", personalGroupId },
      (_session, transaction) => {
        expect(transaction).toBe(fixture.transaction)
        fixture.calls.push("session")
        return Promise.resolve({
          id: 30,
          token: "token",
          userId: 10,
          keyId: 20,
          status: UserSessionStatus.ACTIVE,
          mfa: SessionMFAStatus.NOT_REQUIRED,
          expiresAt: now,
          createdAt: now,
          updatedAt: now,
        })
      },
    )

    expect(result?.user.id).toBe(10)
    expect(fixture.calls).toEqual(["find-key", "user", "key", "group-member", "session"])
    expect(fixture.wasCommitted()).toBe(true)
  })

  it("throws inside transaction when session persistence fails", async () => {
    const fixture = buildFixture()
    await expect(persistPasswordSignup(
      fixture.store,
      { username: "user", passwordHash: "hash", personalGroupId },
      () => Promise.resolve(null),
    )).rejects.toThrow(PasswordSignupPersistenceError)

    expect(fixture.wasCommitted()).toBe(false)
  })

  it("rolls back when failure is injected after every persisted step", async () => {
    const steps: PasswordSignupStep[] = ["user", "key", "personal-group", "session"]
    for (const failingStep of steps) {
      const fixture = buildFixture()
      await expect(persistPasswordSignup(
        fixture.store,
        { username: "user", passwordHash: "hash", personalGroupId },
        () => {
          fixture.calls.push("session")
          return Promise.resolve({
            id: 30,
            token: "token",
            userId: 10,
            keyId: 20,
            status: UserSessionStatus.ACTIVE,
            mfa: SessionMFAStatus.NOT_REQUIRED,
            expiresAt: now,
            createdAt: now,
            updatedAt: now,
          })
        },
        (step) => {
          if (step === failingStep) {
            throw new Error(`fail after ${step}`)
          }
        },
      )).rejects.toThrow(`fail after ${failingStep}`)
      expect(fixture.wasCommitted()).toBe(false)
    }
  })

  it("maps only username unique races to an existing account", async () => {
    const usernameConflict = {
      code: "23505",
      constraint_name: "idx_user_keys_kind_identification",
    }
    const store: PasswordSignupStore<PasswordSignupTransaction> = {
      begin: () => Promise.reject(usernameConflict),
    }
    const result = await persistPasswordSignup(
      store,
      { username: "user", passwordHash: "hash", personalGroupId },
      () => Promise.resolve(null),
    )
    expect(result).toBe(null)

    const otherConflict = { ...usernameConflict, constraint_name: "other_unique_index" }
    const failingStore: PasswordSignupStore<PasswordSignupTransaction> = {
      begin: () => Promise.reject(otherConflict),
    }
    await expect(persistPasswordSignup(
      failingStore,
      { username: "user", passwordHash: "hash", personalGroupId },
      () => Promise.resolve(null),
    )).rejects.toEqual(otherConflict)
  })
})
