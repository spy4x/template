import { User, UserKey, UserSession } from "@domain/identity"
export interface AuthData {
  user: User
  key: UserKey
  session: UserSession
}

export const SESSION_ID_COOKIE_NAME = "sessionIdToken"
