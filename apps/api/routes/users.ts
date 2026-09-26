import { Hono } from "hono"
import { APIContext } from "../_types.ts"
import type { MutationGuards } from "../middlewares/mutation-guards.ts"
import type { SignIn } from "@api/services/sign-in.ts"
import { validate } from "@spy4x/validation"
import { userProfileBaseSchema } from "@domain/identity"
import { UserProfileGetQuery, UserProfileGetResult } from "@api/cqrs/queries.ts"
import { UserProfileUpdateCommand, UserProfileUpdateResult } from "@api/cqrs/commands.ts"
import { requestInfoFromContext } from "@spy4x/platform/request-info"

/** What the users routes call. `index.ts` passes the app's singletons; tests pass fakes. */
export interface UsersRouteDependencies {
  auth: Pick<SignIn["auth"], "isAuthenticated2FA">
  mutationGuards: MutationGuards
  getProfile(query: UserProfileGetQuery): Promise<UserProfileGetResult>
  updateProfile(command: UserProfileUpdateCommand): Promise<UserProfileUpdateResult>
}

export function createUsersRoute(dependencies: UsersRouteDependencies): Hono<APIContext> {
  return new Hono<APIContext>()
    .use(dependencies.auth.isAuthenticated2FA)
    .use(dependencies.mutationGuards.signedIn)
    .get(`/me`, async (c) => {
      const authData = c.get("auth")!
      const result = await dependencies.getProfile(
        new UserProfileGetQuery({ userId: authData.user.id }),
      )
      return c.json({ user: result.user })
    })
    .patch(`/me`, async (c) => {
      const authData = c.get("auth")!
      const body = await c.req.json()
      const validationResult = validate(userProfileBaseSchema, body)
      if (validationResult.error) {
        return c.json({ error: validationResult.error.description }, 400)
      }
      const result = await dependencies.updateProfile(
        new UserProfileUpdateCommand({
          userId: authData.user.id,
          firstName: validationResult.data.firstName,
          lastName: validationResult.data.lastName,
          // trustedProxy: true keeps the old behaviour of trusting X-Forwarded-For / X-Real-IP —
          // the template's production compose runs behind Traefik, which overwrites these headers.
          request: requestInfoFromContext(c, { trustedProxy: true }),
        }),
      )
      return c.json({ user: result.user })
    })
}
