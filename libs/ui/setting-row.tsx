import type { ComponentChildren, JSX } from "preact"
import { Card } from "@spy4x/preact-ui/card"

/**
 * A card of {@link SettingRow}s, one per line, divided by a rule: the shape of a settings page,
 * where each row names a setting, shows its value and offers one action.
 */
export function SettingList({ children }: { children: ComponentChildren }): JSX.Element {
  return (
    <Card>
      <dl class="divide-y divide-subtle">{children}</dl>
    </Card>
  )
}

/**
 * One setting: its name, its current value under it, and an optional action on the right that
 * stays beside the text on a phone.
 */
export function SettingRow(
  { label, value, action, e2e }: {
    label: string
    value: ComponentChildren
    action?: ComponentChildren
    e2e?: string
  },
): JSX.Element {
  return (
    <div
      class="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-1 px-4 py-4 sm:px-6"
      data-e2e={e2e}
    >
      <dt class="text-sm font-medium">{label}</dt>
      {action && <dd class="col-start-2 row-span-2 row-start-1 flex items-center">{action}</dd>}
      <dd class="min-w-0 text-sm text-muted">{value}</dd>
    </div>
  )
}
