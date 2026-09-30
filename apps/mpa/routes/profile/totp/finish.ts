import { PROFILE_FAILURES } from "@ui/profile-screen.tsx"
import { API_BODIES } from "../../../forms.ts"
import { profileAction } from "../../../profile.tsx"

// A refused code shows under the profile form, as the SPA shows it; "Enable 2FA" starts again.
export const handler = profileAction({
  method: "POST",
  path: "/api/auth/totp/connect/finish",
  body: API_BODIES.totpFinish,
  errorAt: "profile",
  failure: PROFILE_FAILURES.totpFinish,
})
