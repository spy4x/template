import { CommandHandler } from "@spy4x/platform/cqrs"
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
  // `updateOne` returns `undefined` only when the row vanished between the check above
  // and this statement - a race, not a normal "not found".
  if (!updatedUser) {
    throw new Error("User not found")
  }

  eventBus.emit(
    new UserProfileUpdatedEvent({ user: updatedUser, request }),
  )

  return { user: updatedUser }
}
