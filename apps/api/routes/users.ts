import { Hono } from "hono"
import { APIContext } from "../_types.ts"
import { isAuthenticated2FA } from "../middlewares/auth.ts"
import { userProfileBaseSchema, validate } from "@shared/types"
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
        request: requestInfoFromContext(c),
      }),
    )
    return c.json({ user: result.user })
  })
