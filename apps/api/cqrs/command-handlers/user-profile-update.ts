import { CommandHandler } from "@shared/cqrs/types.ts"
import { UserProfileUpdateCommand } from "@api/cqrs/commands.ts"
import { db } from "@api/services/db.ts"
import { eventBus } from "@api/services/eventBus.ts"
import { UserProfileUpdatedEvent } from "@api/cqrs/events.ts"

export const userProfileUpdateHandler: CommandHandler<UserProfileUpdateCommand> = async (
  command,
) => {
  const { userId, displayName, request } = command.data
  const user = await db.user.findOne({ id: userId })
  if (!user || user.deletedAt) {
    throw new Error("User not found")
  }

  const profile = await db.userProfile.upsert({
    userId,
    data: {
      displayName,
      updatedBy: userId,
    },
  })

  eventBus.emit(
    new UserProfileUpdatedEvent({ user, profile, request }),
  )

  return { user, profile }
}
