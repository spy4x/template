import { signal } from "@preact/signals"
import { RealtimeRequestError } from "@spy4x/realtime"
import { GroupKind, type GroupRole } from "@domain/groups"
import { apiFetch } from "./api.ts"
import { advanceGroupCursor, realtimeCommand, realtimeQuery } from "./realtime.ts"
import { offlineGroups } from "../offline/groups-offline.ts"
import { currentLayer } from "../offline/index.ts"

/** A group as the API sends it: dates are ISO strings, the sequence a decimal string. */
export interface GroupItem {
  id: string
  kind: GroupKind
  name: string
  role: GroupRole
  authorizationRevision: string
  changeSequence: string
  updatedAt: string
}

/** One page of the API's group list. */
export interface GroupPage {
  groups: GroupItem[]
  nextCursor: string | null
}

/** What the groups store needs from the outside. Injected so tests need no network. */
export interface GroupsDependencies {
  /** Reads one page of the person's groups, over REST or as the socket's `group.list` query. */
  fetchPage(cursor: string | null, via: ReadChannel): Promise<GroupPage>
  /** Creates a shared group and returns it. */
  create(input: { id: string; kind: GroupKind; name: string }): Promise<{ group: GroupItem }>
  /** Records that this page holds a group up to a sequence. */
  advance(groupId: string, sequence: number): void
  newId(): string
  /** What the device already holds of the list, shown before the read answers. */
  readLocal?(): Promise<readonly GroupItem[]>
}

/** How a read reaches the API. */
export type ReadChannel = "rest" | "socket"

const PAGE_LIMIT = 100
/** More pages than any account has groups: a stop for a cursor loop, not a limit people meet. */
const MAX_PAGES = 100

function describe(error: unknown, fallback: string): string {
  return error instanceof RealtimeRequestError ? error.message : fallback
}

/**
 * The groups screen's state: the list, the create form and what is in flight.
 *
 * The list is always a full read of the server's answer, so a read after a missed push and a read
 * at start-up are the same code, and the list cannot drift from the server.
 */
export function createGroupsStore(dependencies: GroupsDependencies) {
  const groups = signal<readonly GroupItem[]>([])
  const name = signal("")
  const loading = signal(false)
  const creating = signal(false)
  const error = signal<string | null>(null)
  /** The last list read failed; cleared by the next read that succeeds. */
  const loadError = signal<string | null>(null)
  let inFlight: Promise<void> | null = null
  let queued: Promise<void> | null = null

  async function readAll(via: ReadChannel): Promise<void> {
    const all: GroupItem[] = []
    let cursor: string | null = null
    for (let page = 0; page < MAX_PAGES; page++) {
      const result = await dependencies.fetchPage(cursor, via)
      all.push(...result.groups)
      cursor = result.nextCursor
      if (cursor === null) break
    }
    groups.value = all
    for (const group of all) dependencies.advance(group.id, Number(group.changeSequence))
  }

  /** Shows what the device holds while the first read runs, unless the read answered first. */
  async function showLocal(): Promise<void> {
    const local = await dependencies.readLocal?.().catch(() => undefined)
    if (local && inFlight && groups.value.length === 0) groups.value = local
  }

  function start(via: ReadChannel): Promise<void> {
    loading.value = true
    if (groups.value.length === 0) void showLocal()
    inFlight = readAll(via).then(
      () => {
        loadError.value = null
      },
      (cause) => {
        loadError.value = describe(cause, "Could not load the groups")
        throw cause
      },
    ).finally(() => {
      inFlight = null
      loading.value = false
    })
    return inFlight
  }

  /**
   * Reads every group, over REST unless told otherwise. A read that is already running may have
   * started before the change that asked for this one, so it is not joined: exactly one more read
   * is queued behind it, and every call made meanwhile shares that one.
   */
  function refresh(via: ReadChannel = "rest"): Promise<void> {
    if (!inFlight) return start(via)
    queued ??= inFlight.catch(() => {}).then(() => {
      queued = null
      return start(via)
    })
    return queued
  }

  /** The refresh button: reads over the socket, and shows a failure instead of rejecting. */
  async function refreshFromUser(): Promise<void> {
    error.value = null
    try {
      await refresh("socket")
    } catch (cause) {
      error.value = describe(cause, "Could not load the groups")
    }
  }

  async function create(): Promise<void> {
    const trimmed = name.value.trim()
    if (creating.value || trimmed.length === 0) return
    creating.value = true
    error.value = null
    try {
      const { group } = await dependencies.create({
        id: dependencies.newId(),
        kind: GroupKind.SHARED,
        name: trimmed,
      })
      groups.value = [group, ...groups.value.filter((existing) => existing.id !== group.id)]
      dependencies.advance(group.id, Number(group.changeSequence))
      name.value = ""
    } catch (cause) {
      error.value = describe(cause, "Could not create the group")
    } finally {
      creating.value = false
    }
  }

  function reset(): void {
    groups.value = []
    name.value = ""
    error.value = null
    loadError.value = null
    loading.value = false
    creating.value = false
    inFlight = null
    queued = null
  }

  return {
    groups,
    name,
    loading,
    creating,
    error,
    loadError,
    refresh,
    refreshFromUser,
    create,
    reset,
  }
}

/** The groups as the server serves them: reads over REST, writes over the socket. */
const onlineGroups: GroupsDependencies = {
  async fetchPage(cursor, via) {
    if (via === "socket") {
      return await realtimeQuery<GroupPage>("group.list", {
        limit: PAGE_LIMIT,
        ...(cursor ? { cursor } : {}),
      })
    }
    const query = new URLSearchParams({ limit: String(PAGE_LIMIT) })
    if (cursor) query.set("cursor", cursor)
    const result = await apiFetch<GroupPage>(`/api/groups?${query}`)
    if (!result.ok) throw new Error(result.error.message)
    return result.data
  },
  create: (input) => realtimeCommand("group.create", input),
  advance: advanceGroupCursor,
  newId: () => crypto.randomUUID(),
}

/**
 * The page's own store: reads over REST (start-up and after a missed push), writes over the
 * socket, and with the offline layer running, served from the device when the network is down.
 */
export const groupsStore = createGroupsStore(offlineGroups(onlineGroups, currentLayer))
