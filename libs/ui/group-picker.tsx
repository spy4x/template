import type { JSX } from "preact"
import { IconCog6Tooth } from "@spy4x/preact-icons"
import { Button } from "@spy4x/preact-ui/button"
import { Combobox } from "@spy4x/preact-ui/combobox"
import { Select } from "@spy4x/preact-ui/input"
import type { GroupRole } from "@domain/groups"
import { ROLE_TEXT } from "./groups-screen.tsx"
import { FORM_ACTIONS, type Navigate, SCREEN_PATHS, ScreenForm } from "./progressive.tsx"

/** One group of the picker: its name, and the person's role in it. */
export interface PickerGroup {
  id: string
  name: string
  role: GroupRole
}

/** What `AppFrame` needs to show the picker; `place` is filled in by the frame. */
export interface GroupPickerData {
  groups: readonly PickerGroup[]
  /** The person's selected group, or `null` before it is known or for a person with no groups. */
  selectedId: string | null
  /**
   * Called with the group the person picked. Given, the picker is a searchable list that works
   * the moment the page runs (the single-page app). Without it, the picker is a form that posts
   * `{ groupId }` to `FORM_ACTIONS.groupSelect` and works without JavaScript (the multi-page app).
   */
  onSelect?: (groupId: string) => void
}

/**
 * The group picker at the bottom of the side menu: a choice of the person's groups, and a cog link
 * to the groups page. `place` keeps the ids of the sidebar's copy and the drawer's copy apart,
 * because `Shell` draws the same slot twice.
 */
export function GroupPicker(
  { groups, selectedId, onSelect, navigate, place }: GroupPickerData & {
    navigate?: Navigate
    place: string
  },
): JSX.Element {
  const id = `${place}-group-picker`
  const labelId = `${id}-label`
  const selected = groups.find((group) => group.id === selectedId) ?? null
  return (
    <div class="flex flex-col gap-2 border-t border-subtle p-3" data-e2e="group-picker">
      <label id={labelId} for={id} class="text-xs font-medium text-muted">Group</label>
      <div class="flex items-center gap-2">
        <div class="min-w-0 flex-1">
          {onSelect
            ? (
              <Combobox
                id={id}
                aria-labelledby={labelId}
                items={groups}
                value={selected}
                getLabel={(group) => group.name}
                onChange={(group) => group && onSelect(group.id)}
                renderOption={(group) => (
                  <span class="flex min-w-0 flex-1 items-baseline justify-between gap-2">
                    <span class="truncate">{group.name}</span>
                    <span class="shrink-0 text-xs text-muted">{ROLE_TEXT[group.role]}</span>
                  </span>
                )}
                showClearButton={false}
                // The picker sits at the bottom of the menu: the list opens upward, into view.
                listboxClass="bottom-full mb-1 mt-0"
                placeholder="Select a group"
                emptyMessage="No group matches"
              />
            )
            : (
              <ScreenForm action={FORM_ACTIONS.groupSelect} class="flex items-center gap-2">
                <Select
                  id={id}
                  name="groupId"
                  class="min-w-0 flex-1"
                  value={selectedId ?? ""}
                  options={groups.map((group) => ({
                    value: group.id,
                    label: `${group.name} · ${ROLE_TEXT[group.role]}`,
                  }))}
                  data-e2e="group-picker-select"
                />
                <Button type="submit" variant="outline" size="sm" data-e2e="group-picker-submit">
                  Switch
                </Button>
              </ScreenForm>
            )}
        </div>
        <Button
          href={SCREEN_PATHS.groups}
          navigate={navigate}
          aria-label="Manage groups"
          data-e2e="group-manage"
          variant="icon"
          size="md"
        >
          <IconCog6Tooth class="size-5" aria-hidden="true" />
        </Button>
      </div>
    </div>
  )
}
