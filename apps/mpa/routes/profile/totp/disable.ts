import { PROFILE_FAILURES } from "@ui/profile-screen.tsx"
import { profileAction } from "../../../profile.tsx"

export const handler = profileAction({
  method: "POST",
  path: "/api/auth/totp/disconnect",
  errorAt: "profile",
  failure: PROFILE_FAILURES.totpDisable,
})
