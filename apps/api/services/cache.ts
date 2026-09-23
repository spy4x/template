import { RedisKvStore } from "@spy4x/server/kv"
import { ValidationSchema } from "@platform/types"
import { AuthAudit, User, UserKey, UserPushToken, UserSession } from "@domain/identity"
import { config } from "../services/config.ts"

import { buildMethods as buildMethodsBase } from "@spy4x/platform/cache"
import { crashOnConnectionLoss, createCacheService } from "./cache-service.ts"

// `RedisKvStore` requires a non-empty key prefix (the template's own kv store did not scope its
// keys at all). "api" is this app's own namespace: every key this cache writes now reads
// `api:<prefix>_<id>` instead of the old unprefixed `<prefix>_<id>` — this is a genuine change,
// not merely a rename; see the PR body and HANDOFF.md's rollback note.
const kv = await RedisKvStore.connect(config.kv.hostname, config.kv.port, "api")
console.log(`✅ Connected to KV`) // kept from the old client's connect log
const cacheService = createCacheService(crashOnConnectionLoss(kv))

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
