import { renderNoteEditor, selectedGroupOrPage } from "../../notes.tsx"
import { define } from "../../utils.ts"

/** The create page: an empty note form for the selected group. The form posts to `/notes`. */
export const handler = define.handlers({
  async GET(ctx) {
    const selected = await selectedGroupOrPage(ctx)
    if ("page" in selected) return selected.page
    return renderNoteEditor(ctx)
  },
})
