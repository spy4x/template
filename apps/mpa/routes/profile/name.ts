import { PROFILE_FAILURES } from "@ui/profile-screen.tsx"
import { API_BODIES } from "../../forms.ts"
import { profileAction } from "../../profile.tsx"

export const handler = profileAction({
  method: "PATCH",
  path: "/api/users/me",
  body: API_BODIES.profile,
  errorAt: "profile",
  failure: PROFILE_FAILURES.profile,
  keep: API_BODIES.profile,
})
