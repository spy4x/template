import { PROFILE_FAILURES } from "@ui/profile-screen.tsx"
import { API_BODIES } from "../../forms.ts"
import { profileAction } from "../../profile.tsx"

export const handler = profileAction({
  method: "POST",
  path: "/api/auth/password/change",
  body: API_BODIES.password,
  errorAt: "password",
  failure: PROFILE_FAILURES.password,
})
