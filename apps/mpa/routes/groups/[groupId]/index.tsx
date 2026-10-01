import { renderGroupSettings } from "../../../group-settings.tsx"
import { define } from "../../../utils.ts"

/** One group's settings page: `GET` shows the group the person belongs to. */
export const handler = define.handlers({
  GET: (ctx) => renderGroupSettings(ctx),
})
