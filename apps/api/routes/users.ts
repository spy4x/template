import { Hono } from "hono"
import type { Actor } from "@domain/identity"
import type { AuthData } from "@api/services/auth/types.ts"
import { APIContext } from "../_types.ts"
import { isAuthenticated2FA } from "../middlewares/auth.ts"
import { validate } from "@platform/types"
import { userProfileBaseSchema } from "@domain/identity"
import { commandBus } from "@api/services/commandBus.ts"
import { queryBus } from "@api/services/queryBus.ts"
import { UserProfileGetQuery } from "@api/cqrs/queries.ts"
import { UserProfileUpdateCommand } from "@api/cqrs/commands.ts"
import { requestInfoFromContext } from "@api/services/request-info.ts"

export const usersRoute = new Hono<APIContext>()
  .use(isAuthenticated2FA)
  .get(`/me`, async (c) => {
    const authData = c.get("auth")
    const result = await queryBus.execute(
      new UserProfileGetQuery({ actor: actorFrom(authData) }),
    )
    return c.json({ user: result.user })
  })
  .patch(`/me`, async (c) => {
    const authData = c.get("auth")
    const body = await c.req.json()
    const validationResult = validate(userProfileBaseSchema, body)
    if (validationResult.error) {
      return c.json({ error: validationResult.error.description }, 400)
    }
    const result = await commandBus.execute(
      new UserProfileUpdateCommand({
        actor: actorFrom(authData),
        firstName: validationResult.data.firstName,
        lastName: validationResult.data.lastName,
        request: requestInfoFromContext(c),
      }),
    )
    return c.json({ user: result.user })
  })

function actorFrom(authData: AuthData): Actor {
  return {
    userId: authData.user.id,
    userMfa: authData.user.mfa,
    sessionMfa: authData.session.mfa,
  }
}
