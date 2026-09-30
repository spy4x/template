import { renderProfile } from "../profile.tsx"
import { define } from "../utils.ts"

/** The profile: the home page of a signed-in user, links to sign-in and sign-up for anyone else. */
export const handler = define.handlers({
  GET: (ctx) => renderProfile(ctx),
})
