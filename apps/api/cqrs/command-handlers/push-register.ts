import type { CommandHandler } from "@spy4x/platform/cqrs"
import { PushRegisterCommand } from "@api/cqrs/commands.ts"
import { PushDevicesUpdatedEvent } from "@api/cqrs/events.ts"
import { eventBus } from "@api/services/eventBus.ts"
import { getWebPush } from "@api/services/webPush.ts"

export const pushRegisterHandler: CommandHandler<PushRegisterCommand> = async (command) => {
  const { actor, subscription, deviceId, request } = command.data
  const webPush = await getWebPush()
  const userPushToken = await webPush.subscribe(subscription, deviceId, actor.userId)
  const devices = await webPush.deviceList(actor.userId)
  eventBus.emit(new PushDevicesUpdatedEvent({ userId: actor.userId, devices, request }))
  return { userPushToken }
}
