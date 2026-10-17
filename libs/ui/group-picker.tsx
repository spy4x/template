import type { JSX } from "preact"
import { IconChevronDown, IconUsers } from "@spy4x/preact-icons"
import type { RailShellSidebarPlace } from "@spy4x/preact-system/rail-shell"
import { Dropdown, DropdownItem } from "@spy4x/preact-ui/dropdown"
import type { GroupColor, GroupRole } from "@domain/groups"
import { GroupMark } from "./group-appearance.tsx"
import { NEW_GROUP_PATH, ROLE_TEXT } from "./groups-screen.tsx"
import { type Navigate, SCREEN_PATHS } from "./progressive.tsx"
import { placeHook } from "./shell-place.ts"

/** One group of the switcher: its name, and the person's role in it. */
export interface PickerGroup {
  id: string
  name: string
  /** The group's colour and emoji, when it has them. */
  color?: GroupColor | null
  emoji?: string | null
  role: GroupRole
}

/** What `AppFrame` needs to show the switcher. */
export interface GroupPickerData {
  groups: readonly PickerGroup[]
  /** The person's selected group, or `null` before it is known or for a person with no groups. */
  selectedId: string | null
  /** Called with the group the person picked. */
  onSelect: (groupId: string) => void
}

/**
 * The group's mark in the switcher: its own colour and emoji, or its initial on a quiet tile when
 * it has neither, so every group has a mark and the names line up.
 */
function SwitcherMark({ group }: { group: PickerGroup }): JSX.Element {
  if (group.color || group.emoji) {
    return <GroupMark color={group.color} emoji={group.emoji} size="sm" />
  }
  return (
    <span
      class="flex size-5 shrink-0 items-center justify-center rounded-md border border-subtle bg-canvas text-xs font-semibold text-muted"
      aria-hidden="true"
    >
      {group.name.trim().charAt(0).toUpperCase()}
    </span>
  )
}

/**
 * The current group at the top of the sidebar: a button showing its mark and name that opens a
 * short menu of the person's groups. The current one is checked (`menuitemradio`), each names the
 * person's role there, and the menu ends with links to all groups and to a new one. In the 72 px
 * icon rail the button shows the mark alone and keeps its name for a screen reader.
 */
export function GroupPicker(
  { groups, selectedId, onSelect, navigate, place = "sidebar" }: GroupPickerData & {
    navigate?: Navigate
    /** Which of `RailShell`'s places draws it; see {@link placeHook}. */
    place?: RailShellSidebarPlace
  },
): JSX.Element {
  const selected = groups.find((group) => group.id === selectedId) ?? null
  const hook = (name: string) => placeHook(name, place)
  const rail = place === "rail"
  return (
    <Dropdown
      trigger={rail
        ? (selected
          ? <SwitcherMark group={selected} />
          : <IconUsers class="size-5 text-muted" aria-hidden="true" />)
        : (
          <>
            {selected && <SwitcherMark group={selected} />}
            <span class="min-w-0 flex-1 truncate text-left">
              {selected?.name ?? "Choose a group"}
            </span>
            <IconChevronDown class="size-4 shrink-0 text-muted" aria-hidden="true" />
          </>
        )}
      triggerLabel={selected ? `Group: ${selected.name}` : "Group: none chosen"}
      triggerDataE2E={hook("group-picker")}
      triggerClasses={rail
        ? "flex size-11 items-center justify-center rounded-md hover:bg-hover"
        : "flex h-11 w-full min-w-0 items-center gap-3 rounded-md px-3 text-sm font-medium text-foreground hover:bg-hover"}
      containerClasses={rail
        ? "relative flex justify-center"
        : "relative flex w-full min-w-0 text-left"}
      panelClasses="w-72 max-w-[calc(100vw-5rem)]"
      horizontal="left"
      menuLabel="Switch group"
    >
      {groups.map((group) => (
        <DropdownItem
          key={group.id}
          checked={group.id === selectedId}
          onClick={() => group.id !== selectedId && onSelect(group.id)}
          dataE2E={hook(`group-picker-${group.id}`)}
        >
          <SwitcherMark group={group} />
          <span class="min-w-0 flex-1 truncate">{group.name}</span>
          {/* A space, so a screen reader says "Home Owner", not "HomeOwner"; flex drops it. */}
          {" "}
          <span class="shrink-0 text-xs text-muted">{ROLE_TEXT[group.role]}</span>
        </DropdownItem>
      ))}
      {groups.length > 0 && <div role="separator" class="my-1 border-t border-subtle" />}
      <DropdownItem
        href={SCREEN_PATHS.groups}
        navigate={navigate}
        dataE2E={hook("group-picker-all")}
      >
        All groups
      </DropdownItem>
      <DropdownItem href={NEW_GROUP_PATH} navigate={navigate} dataE2E={hook("group-picker-new")}>
        New group
      </DropdownItem>
    </Dropdown>
  )
}
