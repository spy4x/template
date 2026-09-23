import { Hono } from "hono"
import { APIContext } from "../_types.ts"
import { isAuthenticated2FA } from "../middlewares/auth.ts"
import { validate } from "@spy4x/validation"
import { userProfileBaseSchema } from "@domain/identity"
import { commandBus } from "@api/services/commandBus.ts"
import { queryBus } from "@api/services/queryBus.ts"
import { UserProfileGetQuery } from "@api/cqrs/queries.ts"
import { UserProfileUpdateCommand } from "@api/cqrs/commands.ts"
import { requestInfoFromContext } from "@spy4x/platform/request-info"

export const usersRoute = new Hono<APIContext>()
  .use(isAuthenticated2FA)
  .get(`/me`, async (c) => {
    const authData = c.get("auth")
    const result = await queryBus.execute(
      new UserProfileGetQuery({ userId: authData.user.id }),
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
