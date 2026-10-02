import { GroupTransferCommand } from "@domain/groups"
import { db } from "../../services/db.ts"
import { eventBus } from "../../services/eventBus.ts"
import { signIn } from "../../services/auth.ts"
import { createGroupTransferHandler } from "../../features/groups/handlers.ts"
import type { CommandHandler } from "@spy4x/platform/cqrs"

export const groupTransferHandler: CommandHandler<GroupTransferCommand> =
  createGroupTransferHandler(db.group, {
    checkPassword: (userId, password) => signIn.checkPassword(userId, password),
    emit: (event) => eventBus.emit(event),
  })
