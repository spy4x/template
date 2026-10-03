import type { JSX } from "preact"
import { IconCheck } from "@spy4x/preact-icons"
import { Combobox } from "@spy4x/preact-ui/combobox"
import type { GroupColor, GroupRole } from "@domain/groups"
import { groupLabel, GroupMark } from "./group-appearance.tsx"
import { ROLE_TEXT } from "./groups-screen.tsx"

/** One group of the picker: its name, and the person's role in it. */
export interface PickerGroup {
  id: string
  name: string
  /** The group's colour and emoji, when it has them. */
  color?: GroupColor | null
  emoji?: string | null
  role: GroupRole
}

/** What `AppFrame` needs to show the picker. */
export interface GroupPickerData {
  groups: readonly PickerGroup[]
  /** The person's selected group, or `null` before it is known or for a person with no groups. */
  selectedId: string | null
  /** Called with the group the person picked. */
  onSelect: (groupId: string) => void
}

/**
 * The id of the picker's text field. It kept its name from the sidebar the picker used to sit in,
 * because the e2e specs of the notes and the groups pick a group through it.
 */
export const GROUP_PICKER_ID = "sidebar-group-picker"

/**
 * The current group in the header: a compact, searchable list of the person's groups. The current
 * one carries a quiet check mark and each option names the person's role there.
 */
export function GroupPicker({ groups, selectedId, onSelect }: GroupPickerData): JSX.Element {
  const labelId = `${GROUP_PICKER_ID}-label`
  const selected = groups.find((group) => group.id === selectedId) ?? null
  return (
    <div class="min-w-0 flex-1 sm:max-w-64 sm:flex-none" data-e2e="group-picker">
      <span id={labelId} class="sr-only">Group</span>
      <Combobox
        id={GROUP_PICKER_ID}
        aria-labelledby={labelId}
        items={groups}
        value={selected}
        getLabel={groupLabel}
        onChange={(group) => group && onSelect(group.id)}
        renderOption={(group, state) => (
          <span class="flex min-w-0 flex-1 items-center gap-2">
            <span class="flex size-4 shrink-0" aria-hidden="true">
              {state.selected && <IconCheck class="size-4" />}
            </span>
            <GroupMark color={group.color} emoji={group.emoji} size="sm" />
            <span class="min-w-0 flex-1 truncate">{group.name}</span>
            <span class="shrink-0 text-xs text-muted">{ROLE_TEXT[group.role]}</span>
          </span>
        )}
        showClearButton={false}
        inputClass="h-11 text-sm font-medium sm:h-9"
        placeholder="Select a group"
        emptyMessage="No group matches"
      />
    </div>
  )
}
