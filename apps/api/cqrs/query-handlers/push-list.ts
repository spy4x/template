import type { QueryHandler } from "@spy4x/platform/cqrs"
import { PushListQuery } from "@api/cqrs/queries.ts"
import { getWebPush } from "@api/services/webPush.ts"

export const pushListHandler: QueryHandler<PushListQuery> = async (query) => {
  const webPush = await getWebPush()
  return { devices: await webPush.deviceList(query.data.actor.userId) }
}
