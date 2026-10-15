import { expect } from "@std/expect"
import { it } from "@std/testing/bdd"
import {
  ADMIN_NO_FILTER,
  type AdminUserDetail,
  type AdminUserFilter,
  type User,
  UserMFAStatus,
  UserRole,
} from "@domain/identity"
import { type AdminApi, type AdminApiResult, createAdminStore } from "./state.ts"

const operator = {
  id: 7,
  firstName: "Olga",
  lastName: "Operator",
  role: UserRole.OPERATOR,
  mfa: UserMFAStatus.NOT_CONFIGURED,
} as User

const detail = { user: { id: 42 } } as AdminUserDetail

const ok = <T>(data: T, status = 200) => ({ ok: true, status, data }) as AdminApiResult<T>
const fail = <T>(status: number, message: string) =>
  ({ ok: false, status, error: { message } }) as AdminApiResult<T>

/** An API that answers each call from `answers` and records what it was asked. */
function fakeApi(answers: Partial<AdminApi> = {}) {
  const calls: unknown[][] = []
  const api: AdminApi = {
    me: () => (calls.push(["me"]), answers.me?.() ?? Promise.resolve(ok(operator))),
    signIn: (
      credentials,
    ) => (calls.push(["signIn", credentials]),
      answers.signIn?.(credentials) ?? Promise.resolve(ok(operator))),
    oneTimeCode: (
      otp,
    ) => (calls.push(["oneTimeCode", otp]),
      answers.oneTimeCode?.(otp) ?? Promise.resolve(ok(operator))),
    signOut: () => (calls.push(["signOut"]), Promise.resolve(ok({}))),
    list: (filter) => (calls.push(["list", filter]),
      answers.list?.(filter) ??
        Promise.resolve(ok({ users: [], total: 0, page: filter.page, pageSize: 25 }))),
    detail: (
      userId,
    ) => (calls.push(["detail", userId]), answers.detail?.(userId) ?? Promise.resolve(ok(detail))),
    act: (
      userId,
      action,
      proof,
    ) => (calls.push(["act", userId, action, proof]),
      answers.act?.(userId, action, proof) ?? Promise.resolve(ok({ user: detail.user }))),
  }
  return { api, calls }
}

/** A store signed in as `user`, with person 42 open and `action`'s dialog showing. */
async function withDialog(api: AdminApi, user: User = operator) {
  const store = createAdminStore(api)
  store.session.value = { step: "signed-in", user, busy: false, error: null }
  await store.loadPerson(42)
  store.openDialog("block")
  return store
}

it("a session the cookie holds signs the operator in at start", async () => {
  const store = createAdminStore(fakeApi().api)
  await store.start()
  expect(store.session.value).toEqual({
    step: "signed-in",
    user: operator,
    busy: false,
    error: null,
  })
})

it("a session that owes its code asks for it, and a missing one asks for the password", async () => {
  const pending = createAdminStore(
    fakeApi({ me: () => Promise.resolve(ok({ secondFactor: "Pending" as const }, 202)) }).api,
  )
  await pending.start()
  expect(pending.session.value.step).toBe("one-time-code")

  const none = createAdminStore(
    fakeApi({ me: () => Promise.resolve(fail(401, "Unauthorized")) }).api,
  )
  await none.start()
  expect(none.session.value.step).toBe("credentials")
})

it("a refused sign-in stays on the password step and shows the API's message", async () => {
  const { api } = fakeApi({ signIn: () => Promise.resolve(fail(401, "Invalid credentials")) })
  const store = createAdminStore(api)
  await store.start()
  store.session.value = { step: "credentials", user: null, busy: false, error: null }
  await store.signIn({ login: "ops@example.com", password: "wrong" })
  expect(store.session.value).toEqual({
    step: "credentials",
    user: null,
    busy: false,
    error: "Invalid credentials",
  })
})

it("a 401 from the list signs the page out, as when the operator was blocked", async () => {
  const { api } = fakeApi({ list: () => Promise.resolve(fail(401, "Unauthorized")) })
  const store = createAdminStore(api)
  await store.start()
  await store.loadList(ADMIN_NO_FILTER)
  expect(store.session.value.step).toBe("credentials")
  expect(store.session.value.user).toBe(null)
})

it("an answer for a filter the page has left is dropped", async () => {
  let answerFirst: (value: AdminApiResult<never>) => void = () => {}
  const first: AdminUserFilter = { ...ADMIN_NO_FILTER, query: "ada" }
  const { api } = fakeApi({
    list: (filter) =>
      filter === first
        ? new Promise((resolve) => answerFirst = resolve)
        : Promise.resolve(ok({ users: [], total: 3, page: 1, pageSize: 25 })),
  })
  const store = createAdminStore(api)
  const late = store.loadList(first)
  await store.loadList(ADMIN_NO_FILTER)
  answerFirst(ok({ users: [], total: 99, page: 1, pageSize: 25 }) as never)
  await late
  expect(store.list.value.list?.total).toBe(3)
  expect(store.list.value.filter).toBe(ADMIN_NO_FILTER)
})

it("an action without a password asks for it and calls nothing", async () => {
  const { api, calls } = fakeApi()
  const store = await withDialog(api)
  await store.act()
  expect(store.dialog.value.errors).toEqual({ password: "Enter your password", form: null })
  expect(calls.some(([name]) => name === "act")).toBe(false)
})

it("a confirmed action sends the password, closes the dialog and reads the person again", async () => {
  const { api, calls } = fakeApi()
  const store = await withDialog(api)
  store.setValue("password", "correct-horse")
  await store.act()
  expect(calls.filter(([name]) => name === "act" || name === "detail")).toEqual([
    ["detail", 42],
    ["act", 42, "block", { password: "correct-horse" }],
    ["detail", 42],
  ])
  expect(store.dialog.value.action).toBe(null)
  expect(store.dialog.value.values).toEqual({ password: "", otp: "" })
})

it("a two-factor operator sends the code too, and is asked for it when it is missing", async () => {
  const { api, calls } = fakeApi()
  const store = await withDialog(api, { ...operator, mfa: UserMFAStatus.CONFIGURED })
  store.setValue("password", "correct-horse")
  await store.act()
  expect(store.dialog.value.errors.otp).toBe("Enter the code from your authenticator app")
  store.setValue("otp", "123456")
  await store.act()
  expect(calls.find(([name]) => name === "act")).toEqual([
    "act",
    42,
    "block",
    { password: "correct-horse", otp: "123456" },
  ])
})

it("a refused action puts the API's message under the field it names", async () => {
  const cases: [string, object][] = [
    ["Invalid password", { password: "Invalid password", form: null }],
    ["Code is incorrect", { otp: "Code is incorrect", form: null }],
    [
      "You cannot do this to someone whose role is yours or higher",
      { form: "You cannot do this to someone whose role is yours or higher" },
    ],
  ]
  for (const [message, errors] of cases) {
    const { api } = fakeApi({ act: () => Promise.resolve(fail(400, message)) })
    const store = await withDialog(api)
    store.setValue("password", "correct-horse")
    await store.act()
    expect(store.dialog.value.errors).toEqual(errors)
    expect(store.dialog.value.action).toBe("block")
    expect(store.dialog.value.pending).toBe(false)
  }
})

it("signing out ends the session even when the server cannot be reached", async () => {
  const { api } = fakeApi()
  api.signOut = () => Promise.reject(new TypeError("Failed to fetch"))
  const store = createAdminStore(api)
  await store.start()
  await store.signOut()
  expect(store.session.value.step).toBe("credentials")
  expect(store.session.value.user).toBe(null)
})
