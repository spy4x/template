import { expect } from "@std/expect"
import { describe, it } from "@std/testing/bdd"
import { drainMicrotasks, FakeClock, FakeSocket } from "@spy4x/realtime/testing"
import { RealtimeRequestError } from "@spy4x/realtime"
import { GroupError } from "@domain/groups"
import { NoteError, NoteVersionConflictError } from "@domain/notes"
import { AccessError, UserMFAStatus } from "@domain/identity"
import { IdempotencyError } from "@server/idempotency/idempotency.ts"
import { buildAuthData } from "../_testing/fake-auth.ts"
import {
  POLICY_CLOSE_CODE,
  Realtime,
  type RealtimeOptions,
  type SocketCall,
  toRequestError,
} from "./realtime.ts"
import type { AppAuthState } from "./sign-in.ts"

interface Harness {
  realtime: Realtime
  clock: FakeClock
  /** Sessions that may still act, by id. Delete one to revoke it. */
  sessions: Map<number, AppAuthState>
  calls: SocketCall[]
  logged: unknown[][]
}

function harness(overrides: Partial<RealtimeOptions> = {}, members: number[] = []): Harness {
  const clock = new FakeClock()
  const sessions = new Map<number, AppAuthState>()
  const calls: SocketCall[] = []
  const logged: unknown[][] = []
  const realtime = new Realtime({
    clock,
    entitledSession: (sessionId) => Promise.resolve(sessions.get(sessionId) ?? null),
    memberUserIds: () => Promise.resolve(members),
    requests: {
      "group.create": {
        kind: "command",
        handle: (call) => {
          calls.push(call)
          return Promise.resolve({ created: true })
        },
      },
      "group.list": {
        kind: "query",
        handle: (call) => {
          calls.push(call)
          return Promise.resolve({ groups: [] })
        },
      },
    },
    log: (...data) => logged.push(data),
    ...overrides,
  })
  return { realtime, clock, sessions, calls, logged }
}

/** Signs a user in on a new socket: the session exists, and the socket is attached and open. */
function connect(h: Harness, userId: number, sessionId = userId * 10): FakeSocket {
  const auth = buildAuthData({ user: { id: userId }, session: { id: sessionId, userId } })
  h.sessions.set(sessionId, auth)
  const socket = new FakeSocket("wss://app.example.com/api/ws")
  socket.openFromPeer()
  expect(h.realtime.attach(socket, auth)).toBe(true)
  return socket
}

/** The closes the service asked for. The registry adds its own clean close once the socket is gone. */
function policyCloses(socket: FakeSocket) {
  return socket.closeCalls.filter((call) => call.code === POLICY_CLOSE_CODE)
}

async function send(socket: FakeSocket, frame: unknown): Promise<void> {
  socket.receive(JSON.stringify(frame))
  await drainMicrotasks()
}

const create = (id: string, extra: Record<string, unknown> = {}) => ({
  kind: "client.command",
  id,
  name: "group.create",
  payload: { name: "Team" },
  idempotencyKey: "key-1",
  ...extra,
})

describe("realtime socket service", () => {
  it("answers a command with the handler's result", async () => {
    const h = harness()
    const socket = connect(h, 1)

    await send(socket, create("r1"))

    expect(socket.frames()).toEqual([
      { kind: "server.result", requestId: "r1", payload: { created: true } },
    ])
    h.realtime.shutdown()
  })

  it("refuses a command without an idempotency key and does not run it", async () => {
    const h = harness()
    const socket = connect(h, 1)

    await send(socket, { ...create("r1"), idempotencyKey: undefined })

    expect(socket.frames()).toEqual([
      {
        kind: "server.error",
        requestId: "r1",
        code: "bad_request",
        message: "a command needs an idempotency key",
      },
    ])
    expect(h.calls).toEqual([])
    h.realtime.shutdown()
  })

  it("answers not_found to an unknown name and to a query sent as a command", async () => {
    const h = harness()
    const socket = connect(h, 1)

    await send(socket, create("r1", { name: "group.destroy" }))
    await send(socket, create("r2", { name: "group.list" }))

    const codes = socket.frames().map((frame) => (frame as { code: string }).code)
    expect(codes).toEqual(["not_found", "not_found"])
    expect(h.calls).toEqual([])
    h.realtime.shutdown()
  })

  it("builds the actor from the session as it is now, not as the socket opened", async () => {
    const h = harness()
    const socket = connect(h, 1, 10)

    await send(socket, create("r1"))
    h.sessions.set(10, buildAuthData({ user: { id: 1, mfa: UserMFAStatus.CONFIGURED } }))
    await send(socket, create("r2"))

    expect(h.calls.map((call: SocketCall) => call.actor.userMfa)).toEqual([
      UserMFAStatus.NOT_CONFIGURED,
      UserMFAStatus.CONFIGURED,
    ])
    h.realtime.shutdown()
  })

  it("refuses a request from a session revoked after the upgrade and closes the socket", async () => {
    const h = harness()
    const socket = connect(h, 1, 10)
    h.sessions.delete(10)

    await send(socket, create("r1"))
    await h.clock.advance(0)

    expect(socket.frames()).toEqual([
      {
        kind: "server.error",
        requestId: "r1",
        code: "unauthorized",
        message: "the session is no longer valid",
      },
    ])
    expect(h.calls).toEqual([])
    expect(policyCloses(socket)).toEqual([{
      code: POLICY_CLOSE_CODE,
      reason: "session is no longer valid",
    }])
    h.realtime.shutdown()
  })

  it("answers a domain error with its typed code and hides any other failure", async () => {
    const failures = [
      new GroupError("ID_ALREADY_EXISTS", "Group id is already in use"),
      new Error("connection to 10.0.0.5 refused"),
    ]
    const h = harness({
      requests: {
        "group.create": { kind: "command", handle: () => Promise.reject(failures.shift()) },
      },
    })
    const socket = connect(h, 1)

    await send(socket, create("r1"))
    await send(socket, create("r2"))

    expect(socket.frames()).toEqual([
      {
        kind: "server.error",
        requestId: "r1",
        code: "conflict",
        message: "Group id is already in use",
        details: { code: "ID_ALREADY_EXISTS" },
      },
      { kind: "server.error", requestId: "r2", code: "internal", message: "internal error" },
    ])
    expect(String(h.logged[0]?.[1])).toContain("10.0.0.5")
    h.realtime.shutdown()
  })

  it("acknowledges the sync handshake", async () => {
    const h = harness()
    const socket = connect(h, 1)

    await send(socket, { kind: "client.sync", id: "s1", cursors: [], fromStart: true })

    expect(socket.frames()).toEqual([{ kind: "server.ack", ackId: "s1" }])
    h.realtime.shutdown()
  })
})

describe("realtime socket revocation", () => {
  it("closes exactly the sockets whose session was revoked, with the policy code", async () => {
    const h = harness()
    const kept = connect(h, 1)
    const revoked = connect(h, 2)
    h.sessions.delete(20)

    const closed = await h.realtime.revalidate()

    expect(closed).toBe(1)
    expect(policyCloses(revoked)).toEqual([{
      code: POLICY_CLOSE_CODE,
      reason: "session is no longer valid",
    }])
    expect(kept.closeCalls).toEqual([])
    h.realtime.shutdown()
  })

  it("closes every socket of a revoked session, and reads the session once", async () => {
    let reads = 0
    const h = harness({
      entitledSession: () => {
        reads++
        return Promise.resolve(null)
      },
    })
    const first = connect(h, 1, 10)
    const second = connect(h, 1, 10)

    await h.realtime.revalidate()

    expect(policyCloses(first).length).toBe(1)
    expect(policyCloses(second).length).toBe(1)
    expect(reads).toBe(1)
    h.realtime.shutdown()
  })

  it("revalidates only the named user's sockets", async () => {
    const h = harness()
    const mine = connect(h, 1)
    const theirs = connect(h, 2)
    h.sessions.clear()

    await h.realtime.revalidate(1)

    expect(policyCloses(mine).length).toBe(1)
    expect(theirs.closeCalls).toEqual([])
    h.realtime.shutdown()
  })

  it("closes a revoked socket when the revalidation interval passes, and not before", async () => {
    const h = harness()
    const socket = connect(h, 1)
    const stop = h.realtime.startRevalidation(15_000)
    h.sessions.delete(10)

    await h.clock.advance(14_999)
    await drainMicrotasks()
    expect(policyCloses(socket)).toHaveLength(0)

    await h.clock.advance(1)
    await drainMicrotasks()
    expect(policyCloses(socket)).toHaveLength(1)

    stop()
    h.realtime.shutdown()
  })

  it("stops revalidating once the returned stop function is called", async () => {
    const h = harness()
    const socket = connect(h, 1)
    h.realtime.startRevalidation(15_000)()
    h.sessions.delete(10)

    await h.clock.advance(60_000)
    await drainMicrotasks()

    expect(policyCloses(socket)).toHaveLength(0)
    h.realtime.shutdown()
  })

  it("keeps a socket open when its session cannot be read, and logs why", async () => {
    const h = harness({ entitledSession: () => Promise.reject(new Error("db down")) })
    const socket = connect(h, 1)

    const closed = await h.realtime.revalidate()

    expect(closed).toBe(0)
    expect(socket.closeCalls).toEqual([])
    expect(h.logged.length).toBe(1)
    h.realtime.shutdown()
  })
})

describe("realtime group hints", () => {
  it("sends the sequence-stamped hint to the group's members and nobody else", async () => {
    const h = harness({}, [1])
    const member = connect(h, 1)
    const secondTab = connect(h, 1, 11)
    const stranger = connect(h, 2)

    await h.realtime.notifyGroupChange("0b1f3c58-7f55-4a5d-8f6e-6a3a5a9d1a01", 4)

    const hint = { kind: "change.hint", groupId: "0b1f3c58-7f55-4a5d-8f6e-6a3a5a9d1a01" } as const
    expect(member.frames()).toEqual([{ ...hint, aggregate: "group", sequence: 4 }])
    expect(secondTab.frames()).toEqual([{ ...hint, aggregate: "group", sequence: 4 }])
    expect(stranger.frames()).toEqual([])
    h.realtime.shutdown()
  })

  it("sends nothing when the members cannot be read", async () => {
    const h = harness({ memberUserIds: () => Promise.reject(new Error("db down")) })
    const socket = connect(h, 1)

    await h.realtime.notifyGroupChange("0b1f3c58-7f55-4a5d-8f6e-6a3a5a9d1a01", 4)

    expect(socket.frames()).toEqual([])
    expect(h.logged.length).toBe(1)
    h.realtime.shutdown()
  })
})

describe("toRequestError", () => {
  it("maps each domain failure to a closed error code", () => {
    const code = (error: unknown) => toRequestError(error)?.code
    expect(code(new GroupError("INVALID_REQUEST", "x"))).toBe("bad_request")
    expect(code(new GroupError("GROUP_NOT_FOUND", "x"))).toBe("not_found")
    expect(code(new GroupError("ROLE_INSUFFICIENT", "x"))).toBe("forbidden")
    expect(code(new GroupError("USER_NOT_ACTIVE", "x"))).toBe("unauthorized")
    expect(code(new AccessError("MFA_REQUIRED", "x"))).toBe("unauthorized")
    expect(code(new IdempotencyError("KEY_REUSED", "x"))).toBe("conflict")
    expect(code(new IdempotencyError("IN_PROGRESS", "x"))).toBe("conflict")
    expect(code(new IdempotencyError("INVALID_KEY", "x"))).toBe("bad_request")
    expect(code(new RealtimeRequestError("rate_limited", "x"))).toBe("rate_limited")
  })

  it("maps each note failure to a closed code and keeps the note's code in the details", () => {
    const code = (error: unknown) => toRequestError(error)?.code
    expect(code(new NoteError("INVALID_REQUEST", "x"))).toBe("bad_request")
    expect(code(new NoteError("GROUP_NOT_FOUND", "x"))).toBe("not_found")
    expect(code(new NoteError("NOTE_NOT_FOUND", "x"))).toBe("not_found")
    expect(code(new NoteError("ROLE_INSUFFICIENT", "x"))).toBe("forbidden")
    expect(toRequestError(new NoteError("ROLE_INSUFFICIENT", "x"))?.details).toEqual({
      code: "ROLE_INSUFFICIENT",
    })
  })

  it("tells the client the current version of a note it tried to overwrite", () => {
    const error = toRequestError(new NoteVersionConflictError(5))
    expect(error?.code).toBe("conflict")
    expect(error?.details).toEqual({ code: "VERSION_CONFLICT", currentVersion: 5 })
  })

  it("does not describe an unexpected failure", () => {
    expect(toRequestError(new Error("boom"))).toBeNull()
  })
})
