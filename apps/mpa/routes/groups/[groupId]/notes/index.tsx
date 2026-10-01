import { redirectFromOldNotesPath } from "../../../../notes.tsx"
import { define } from "../../../../utils.ts"

/** An old `/groups/:groupId/notes` link; see {@link redirectFromOldNotesPath}. */
export const handler = define.handlers({
  GET: (ctx) => redirectFromOldNotesPath(ctx, ctx.params.groupId),
})
