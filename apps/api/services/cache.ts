import { KeyValueService } from "@server/kv"
import {
  User,
  UserKey,
  UserProfile,
  UserSession,
  UserPushToken,
  AuthAudit,
  ValidationSchema,
} from "@shared/types"

import { config } from "../services/config.ts"

import { buildMethods as buildMethodsBase, CacheService } from "@shared/cache"

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
  userProfile = buildMethods<UserProfile>(`userProfile`)
  userSession = buildMethods<UserSession>(`userSession`)
  userPushToken = buildMethods<UserPushToken>(`userPushToken`)
  authAudit = buildMethods<AuthAudit>(`authAudit`)
  isSessionTokenExpired = buildMethodsBase<boolean>(
    cacheService,
    `isSessionTokenExpired`,
    CacheTTL.day,
  )
}

export const publicAPICache = new PublicAPICache()
