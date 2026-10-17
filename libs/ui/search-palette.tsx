import type { JSX } from "preact"
import { useRef, useState } from "preact/hooks"
import {
  CommandPalette,
  type CommandPaletteLabels,
  type CommandPaletteOption,
  rankOptions,
} from "@spy4x/preact-ui/command-palette"
import { type GroupRole } from "@domain/groups"
import { ROLE_TEXT } from "./groups-screen.tsx"
import { GROUP_PATHS, NOTE_PATHS, SCREEN_PATHS, TAG_PATHS } from "./progressive.tsx"

/** One note a search found, as the palette lists it. */
export interface SearchNote {
  id: string
  groupId: string
  title: string
  /** Plain text around the match, with "…" where it was cut; empty for an empty body. */
  snippet: string
}

/** What a note search answered, and where from. */
export interface SearchNotesAnswer {
  notes: readonly SearchNote[]
  /** `true` when the notes come from this device's copy, because the server could not be asked. */
  onDevice: boolean
}

/** One of the person's groups, matched by its name as they type. */
export interface SearchGroup {
  id: string
  name: string
  role: GroupRole
}

/** What a picked result asks the app to do. */
export type SearchChoice =
  /** Open the note, switching to its group first when it is another one. */
  | { kind: "note"; noteId: string; groupId: string }
  /** Open the group's page. */
  | { kind: "group"; groupId: string }
  /** Go to a page of the app. */
  | { kind: "page"; href: string }

/** Props of {@link SearchPalette}. */
export interface SearchPaletteProps {
  /**
   * The notes for a query of at least {@link NOTE_QUERY_MIN} characters, best first; for the empty
   * query, the current group's most recent ones. `signal` aborts when the answer is no longer
   * wanted. A rejection shows the error line.
   */
  searchNotes: (query: string, signal: AbortSignal) => Promise<SearchNotesAnswer>
  /** Every group the person belongs to now. */
  groups: readonly SearchGroup[]
  /** The group the notes pages show, and whether the person may add notes and tags to it. */
  currentGroup: { id: string; name: string; canWrite: boolean } | null
  /** Whether the server can be reached: "New group" needs it. */
  online: boolean
  /** Called with what the person picked, after the palette has closed. */
  onSelect: (choice: SearchChoice) => void
  /** Where the frame draws the trigger; see {@link SearchPlace}. Defaults to `"sidebar"`. */
  place?: SearchPlace
}

/**
 * Where `AppFrame` draws a search trigger: under the group switcher in the labelled sidebar (from
 * `lg`), or in the 72 px icon rail (from `md`). A phone has no column, so its palette (`"sheet"`)
 * has a hidden trigger, and the Account sheet's "Search" entry opens it. The frame draws one per
 * place and CSS shows the one that fits, so the hotkeys reach the visible one only (a hidden
 * trigger ignores them).
 */
export type SearchPlace = "sidebar" | "rail" | "sheet"

/**
 * The trigger's look per place, over the library's (an icon below `sm`, a field from `sm`).
 * - The sidebar: a field the column's width with the words. The column is too narrow for the words
 *   and the hotkey hint as well, so the hint is left out; the hotkeys still work and the trigger
 *   still announces them.
 * - The rail: an icon the size of the rail's others, in a 44 px cell; its name is its tooltip.
 * - The sheet: no trigger of its own; the Account sheet's entry opens the palette.
 */
const TRIGGER_CLASS: Record<SearchPlace, string> = {
  sidebar: "min-h-11 w-full min-w-0 whitespace-nowrap sm:w-full lg:w-full [&>span+span]:hidden",
  rail:
    "min-h-11 w-full justify-center rounded-md px-0 hover:bg-canvas sm:w-full sm:border-transparent sm:bg-transparent sm:px-0 sm:hover:border-transparent lg:w-full [&>span]:hidden [&>svg]:size-6",
  sheet: "hidden",
}

/** The fewest characters a note search takes; one letter finds too much. The API holds the same. */
export const NOTE_QUERY_MIN = 2

/** How many of the current group's notes the palette lists before anything is typed. */
export const RECENT_NOTES = 5

/** The most characters of the query the no-results line repeats. */
const QUOTED_MAX = 40

/** A row of the palette, carrying what picking it does. */
interface SearchOption extends CommandPaletteOption {
  choice: SearchChoice
}

const HEADINGS = {
  notes: "Notes",
  notesOnDevice: "Notes on this device",
  groups: "Groups",
  actions: "Actions",
} as const

/** The palette's fixed words; the no-results line is set per answer. */
const LABELS: Omit<CommandPaletteLabels, "empty"> = {
  search: "Search",
  placeholder: "Search notes and groups",
  close: "Close search",
  loading: "Searching…",
  error: "Could not search. Change the text to try again.",
}

/** `query` trimmed and cut to {@link QUOTED_MAX} characters, an emoji counting as one. */
export function quoted(query: string): string {
  const characters = Array.from(query.trim())
  return characters.length > QUOTED_MAX
    ? `${characters.slice(0, QUOTED_MAX).join("")}…`
    : characters.join("")
}

/** The no-results line for `query`, which says where the search looked. */
export function emptyLabel(query: string, onDevice: boolean): string {
  return onDevice
    ? `Nothing on this device matches “${quoted(query)}”. Search again when you are back online.`
    : `No notes or groups match “${quoted(query)}”.`
}

/**
 * The search of the signed-in shell, opened with Ctrl K (⌘K on a Mac) or `/` from every page, or
 * from its trigger. `AppFrame` draws one trigger per place ({@link SearchPlace}); only the visible
 * one answers the hotkeys.
 *
 * Before anything is typed it lists the current group's most recent notes, then the actions. A
 * query lists the notes that match (from `searchNotes`), then the person's groups whose name
 * matches, then the matching actions. When the notes come from the device, their heading and the
 * no-results line say so. An action the person cannot take now is not listed: "New note" and
 * "New tag" need a group they may write to, and "New group" needs the server.
 */
export function SearchPalette(props: SearchPaletteProps): JSX.Element {
  const place = props.place ?? "sidebar"
  const [empty, setEmpty] = useState(emptyLabel("", false))
  // The search runs inside the palette, after a render; it reads the latest props through this.
  const latest = useRef(props)
  latest.current = props

  const search = async (query: string, signal: AbortSignal): Promise<SearchOption[]> => {
    const { groups, currentGroup, online } = latest.current
    const text = query.trim()
    const asksNotes = text === "" || Array.from(text).length >= NOTE_QUERY_MIN
    const answer = asksNotes
      ? await latest.current.searchNotes(text, signal)
      : { notes: [], onDevice: false }
    // The recent notes are all the current group's, so only a query's rows name their group.
    const namesGroup = text !== "" && groups.length > 1
    const groupName = new Map(groups.map((group) => [group.id, group.name]))
    const notesHeading = answer.onDevice ? HEADINGS.notesOnDevice : HEADINGS.notes
    const notes = answer.notes.slice(0, text === "" ? RECENT_NOTES : undefined).map((
      note,
    ): SearchOption => ({
      id: `note-${note.id}`,
      label: note.title.trim() || "Untitled note",
      detail: noteDetail(note, namesGroup ? groupName.get(note.groupId) : undefined),
      group: notesHeading,
      choice: { kind: "note", noteId: note.id, groupId: note.groupId },
    }))
    const groupRows = text === "" ? [] : rankOptions(
      groups.map((group) => ({ label: group.name, group })),
      text,
    ).map(({ group }): SearchOption => ({
      id: `group-${group.id}`,
      label: group.name,
      detail: ROLE_TEXT[group.role],
      hint: group.id === currentGroup?.id ? "Current" : undefined,
      group: HEADINGS.groups,
      choice: { kind: "group", groupId: group.id },
    }))
    const actions = rankOptions(actionOptions(currentGroup, online), text)
    // A stale answer is dropped by the palette; its words must not replace the current ones.
    if (!signal.aborted) setEmpty(emptyLabel(text, answer.onDevice))
    return [...notes, ...groupRows, ...actions]
  }

  return (
    <CommandPalette<SearchOption>
      search={search}
      onSelect={(option) => props.onSelect(option.choice)}
      hotkeys={["mod+k", "/"]}
      labels={{ ...LABELS, empty }}
      dataE2E={place === "sidebar" ? "search" : `search-${place}`}
      class={TRIGGER_CLASS[place]}
    />
  )
}

/** A note row's second line: the group, when the person has several, then the snippet. */
function noteDetail(note: SearchNote, groupName: string | undefined): string | undefined {
  const parts = [groupName, note.snippet].filter((part) => part !== undefined && part !== "")
  return parts.length > 0 ? parts.join(" · ") : undefined
}

/** The actions a person can take now, in the order the palette lists them. */
function actionOptions(
  currentGroup: SearchPaletteProps["currentGroup"],
  online: boolean,
): SearchOption[] {
  const page = (id: string, label: string, href: string, detail?: string): SearchOption => ({
    id: `action-${id}`,
    label,
    detail,
    group: HEADINGS.actions,
    choice: { kind: "page", href },
  })
  const inGroup = currentGroup?.canWrite ? `In ${currentGroup.name}` : null
  return [
    ...(inGroup ? [page("new-note", "New note", NOTE_PATHS.new, inGroup)] : []),
    ...(inGroup ? [page("new-tag", "New tag", TAG_PATHS.new, inGroup)] : []),
    ...(online ? [page("new-group", "New group", GROUP_PATHS.new)] : []),
    page("notifications", "Open notifications", SCREEN_PATHS.notifications),
    page(
      "profile",
      "Open profile",
      SCREEN_PATHS.profile,
      "Name, e-mail address, password, two-factor sign-in",
    ),
  ]
}
