import { NOTE_PATHS, SCREEN_PATHS } from "@ui/progressive.tsx"
import { API_BODIES, readForm } from "../../forms.ts"
import { selectGroup } from "../../groups.ts"
import { define } from "../../utils.ts"

/**
 * The group picker's form and the "Open notes" buttons: `POST { groupId }` selects the group, then
 * shows its notes. A group the API refuses (gone, or the person left it) leaves the selection as it
 * was and sends the person to the groups page, where the list shows what is left.
 */
export const handler = define.handlers({
  async POST(ctx) {
    const { groupId } = API_BODIES.groupSelect(await readForm(ctx.req))
    const selected = await selectGroup(ctx.state.api, groupId)
    return ctx.redirect(selected ? NOTE_PATHS.list : SCREEN_PATHS.groups, 303)
  },
})
