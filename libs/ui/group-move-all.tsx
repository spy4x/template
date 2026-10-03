import type { JSX } from "preact"
import { useState } from "preact/hooks"
import { Button } from "@spy4x/preact-ui/button"
import { ErrorState } from "@spy4x/preact-ui/error-state"
import { Field } from "@spy4x/preact-ui/field"
import { Select } from "@spy4x/preact-ui/input"
import { Cluster, Stack } from "@spy4x/preact-ui/layout"
import type { MoveTarget } from "./notes-screen.tsx"
import { ScreenForm } from "./progressive.tsx"

/** What a finished move tells the person: how many items went, and where. */
export interface MoveAllResult {
  count: number
  toName: string
}

export interface GroupMoveAllFormProps {
  groupName: string
  /** The groups the person may write to, other than this one. Never empty when the form shows. */
  targets: readonly MoveTarget[]
  /** A move is in flight. */
  moving?: boolean
  /** Why the move was refused, or `null`. */
  error?: string | null
  /** The finished move, or `null` while there is none. */
  result?: MoveAllResult | null
  /** Moves everything to the chosen group. */
  onMove?: (toGroupId: string) => void
  /** Closes the dialog the form sits in. */
  onCancel?: () => void
  /**
   * Opens the delete confirmation for this group. Left out when the group cannot be deleted by this
   * person now, so the result offers only "Keep the group".
   */
  onDelete?: () => void
}

/**
 * Moving all of a group's data to another group, in a dialog. The person picks the group and
 * confirms. Afterwards the dialog says how many items moved and offers to delete the emptied group,
 * or to keep it. Pure: the app owns the request.
 */
export function GroupMoveAllForm(
  { groupName, targets, moving = false, error = null, result = null, onMove, onCancel, onDelete }:
    GroupMoveAllFormProps,
): JSX.Element {
  const [toGroupId, setToGroupId] = useState(targets[0]?.id ?? ``)
  if (result) {
    return (
      <Stack gap="lg">
        <p class="text-sm" role="status" data-e2e="group-move-all-done">
          Moved {result.count} {result.count === 1 ? `item` : `items`} from "{groupName}" to "
          {result.toName}". Deleted items stay behind and go with the group.
        </p>
        <Cluster gap="md" class="justify-end">
          <Button
            type="button"
            variant="ghost"
            class="min-h-11 sm:min-h-9"
            onClick={onCancel}
            data-e2e="group-move-all-keep"
          >
            Keep the group
          </Button>
          {onDelete && (
            <Button
              type="button"
              variant="danger"
              class="min-h-11 sm:min-h-9"
              onClick={onDelete}
              data-e2e="group-move-all-delete"
            >
              Delete "{groupName}"...
            </Button>
          )}
        </Cluster>
      </Stack>
    )
  }
  return (
    <ScreenForm
      pending={moving}
      onSubmit={() => {
        if (toGroupId) onMove?.(toGroupId)
      }}
    >
      <Stack gap="lg">
        <p class="text-sm text-muted" data-e2e="group-move-all-explanation">
          Every note in "{groupName}" moves to the group you pick, and its members stop seeing them.
          Members of the other group see them right away. The ids and history stay. Nothing moves if
          any of it fails.
        </p>
        <Field id="group-move-all-to" label="Move everything to">
          <Select
            name="toGroupId"
            data-e2e="group-move-all-to"
            value={toGroupId}
            onChange={(event) => setToGroupId(event.currentTarget.value)}
            options={targets.map((target) => ({ value: target.id, label: target.name }))}
          />
        </Field>
        <ErrorState message={error} />
        <Cluster gap="md" class="justify-end">
          <Button
            type="button"
            variant="ghost"
            class="min-h-11 sm:min-h-9"
            onClick={onCancel}
            data-e2e="group-move-all-cancel"
          >
            Cancel
          </Button>
          <Button
            type="submit"
            class="min-h-11 sm:min-h-9"
            busy={moving}
            busyLabel="Moving..."
            data-e2e="group-move-all-submit"
          >
            Move everything
          </Button>
        </Cluster>
      </Stack>
    </ScreenForm>
  )
}
