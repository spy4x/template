import { KeyValueService } from "@server/kv"
import { ValidationSchema } from "@platform/types"
import { AuthAudit, User, UserKey, UserPushToken, UserSession } from "@domain/identity"
import { config } from "../services/config.ts"

import { buildMethods as buildMethodsBase, CacheService } from "@platform/cache"

const kv = await KeyValueService.connect(config.kv.hostname, config.kv.port)
const cacheService = new CacheService(kv)

function buildMethods<T>(prefix: string, schema?: ValidationSchema) {
  return buildMethodsBase<T>(cacheService, prefix, CacheTTL.month, schema)
}

export enum CacheTTL {
  threeMin = 180,
  fiveMin = 300,
  oneHour = 3600,
  day = 86400,
  week = 604800,
  month = 2592000,
}

export class PublicAPICache {
  user = buildMethods<User>(`user`)
  userKey = buildMethods<UserKey>(`userKey`)
  userSession = buildMethods<UserSession>(`userSession`)
  userPushToken = buildMethods<UserPushToken>(`userPushToken`)
  authAudit = buildMethods<AuthAudit>(`authAudit`)
  isSessionTokenExpired = buildMethodsBase<boolean, string>(
    cacheService,
    `isSessionTokenExpired`,
    CacheTTL.day,
  )
}

export const publicAPICache = new PublicAPICache()
