import { config } from "@api/services/config.ts"
import { signIn } from "@api/services/auth.ts"
import { createProfileSocketRoute } from "@api/services/wsHub.ts"

// The browser sends the web app's origin; behind the TLS-terminating proxy the API sees `http://`.
export const wsRoute = createProfileSocketRoute({
  auth: signIn.auth,
  expectedOrigin: new URL(config.webAppUrl).origin,
})
