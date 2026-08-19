import { CommandHandler } from "@platform/cqrs/types.ts"
import { UserProfileUpdateCommand } from "@api/cqrs/commands.ts"
import { db } from "@api/services/db.ts"
import { eventBus } from "@api/services/eventBus.ts"
import { UserProfileUpdatedEvent } from "@api/cqrs/events.ts"

export const userProfileUpdateHandler: CommandHandler<UserProfileUpdateCommand> = async (
  command,
) => {
  const { userId, firstName, lastName, request } = command.data
  const user = await db.user.findOne({ id: userId })
  if (!user || user.deletedAt) {
    throw new Error("User not found")
  }

  const updatedUser = await db.user.updateOne({
    id: userId,
    data: {
      firstName,
      lastName,
    },
  })

  eventBus.emit(
    new UserProfileUpdatedEvent({ user: updatedUser, request }),
  )

  return { user: updatedUser }
}
