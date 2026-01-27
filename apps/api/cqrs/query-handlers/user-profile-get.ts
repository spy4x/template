import { QueryHandler } from "@shared/cqrs/types.ts"
import { UserProfileGetQuery } from "@api/cqrs/queries.ts"
import { db } from "@api/services/db.ts"

export const userProfileGetHandler: QueryHandler<UserProfileGetQuery> = async (query) => {
  const { userId } = query.data
  const user = await db.user.findOne({ id: userId })
  if (!user || user.deletedAt) {
    throw new Error("User not found")
  }
  const profile = await db.userProfile.findByUser({ userId })
  return { user, profile }
}
