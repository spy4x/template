import { config } from "./config.ts"
import { db } from "./db.ts"
import { createSignIn } from "./sign-in.ts"

/** The app's sign-in, configured from the environment. */
export const signIn = createSignIn({
  db,
  pepper: config.authPepper,
  cookieSecret: config.authCookieSecret,
  secureCookie: !config.isDev,
  sessionMinutes: config.authSessionDurationMin,
  totpIssuer: config.domain,
})

export const { parseAuth, isAuthenticated1FA, isAuthenticated2FA } = signIn.auth
