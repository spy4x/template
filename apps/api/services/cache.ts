import { RedisKvStore } from "@spy4x/server/kv"
import { ValidationSchema } from "@platform/types"
import { AuthAudit, User, UserKey, UserPushToken, UserSession } from "@domain/identity"
import { config } from "../services/config.ts"

import {
  buildMethods as buildMethodsBase,
  CacheService,
  reviveIsoDatesEndingInAt,
} from "@spy4x/platform/cache"

// `RedisKvStore` requires a non-empty key prefix (the template's own kv store did not scope its
// keys at all). "api" is this app's own namespace: every key this cache writes now reads
// `api:<prefix>_<id>` instead of the old unprefixed `<prefix>_<id>` — see the PR body.
const kv = await RedisKvStore.connect(config.kv.hostname, config.kv.port, "api")
// The template's old CacheService revived every "*At"-suffixed string into a Date unconditionally;
// the package makes that opt-in via `reviver`. Passing `reviveIsoDatesEndingInAt` keeps that
// behaviour unchanged.
const cacheService = new CacheService(kv, { reviver: reviveIsoDatesEndingInAt })

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
