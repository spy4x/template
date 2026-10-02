import { renderInvitation } from "../../invitations.tsx"
import { define } from "../../utils.ts"

/** The page an invitation link opens: the group, who invited and the role, with Accept and Decline. */
export const handler = define.handlers({
  GET: (ctx) => renderInvitation(ctx, ctx.params.token),
})
