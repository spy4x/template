import { auth } from "@api/services/auth/+index.ts"
import { createParseAuth, isAuthenticated1FA, isAuthenticated2FA, isRole } from "./auth-guards.ts"

export const parseAuth = createParseAuth((context) => auth.getForRequest(context))
export { isAuthenticated1FA, isAuthenticated2FA, isRole }
