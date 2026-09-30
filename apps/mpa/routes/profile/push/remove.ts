import { PROFILE_FAILURES } from "@ui/profile-screen.tsx"
import { API_BODIES } from "../../../forms.ts"
import { profileAction } from "../../../profile.tsx"

export const handler = profileAction({
  method: "DELETE",
  path: "/api/push",
  body: API_BODIES.pushRemove,
  errorAt: "push",
  failure: PROFILE_FAILURES.push,
})
