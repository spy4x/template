import type { CommandHandler } from "@spy4x/platform/cqrs"
import { PushRemoveCommand } from "@api/cqrs/commands.ts"
import { PushDevicesUpdatedEvent } from "@api/cqrs/events.ts"
import { eventBus } from "@api/services/eventBus.ts"
import { getWebPush } from "@api/services/webPush.ts"

export const pushRemoveHandler: CommandHandler<PushRemoveCommand> = async (command) => {
  const { actor, deviceId, request } = command.data
  const webPush = await getWebPush()
  await webPush.unsubscribe(deviceId, actor.userId)
  const devices = await webPush.deviceList(actor.userId)
  eventBus.emit(new PushDevicesUpdatedEvent({ userId: actor.userId, devices, request }))
  return { isSuccess: true }
}
