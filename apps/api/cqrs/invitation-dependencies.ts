import { effectivePlanId, entitlementsOf } from "@domain/billing"
import { provenAddressOwner } from "@server/auth/email-verification.ts"
import { createMailSender, readMailSetup } from "@server/mail/mail.ts"
import { PostgresInvitationRepository } from "@server/groups/postgres-invitation-repository.ts"
import { createRedisRateLimitStore } from "@spy4x/server/kv"
import type { InvitationHandlerDependencies } from "../features/groups/invitations.ts"
import { createInvitationRateLimits } from "../features/groups/invitation-rate-limits.ts"
import { billingSetup } from "../services/billing.ts"
import { kv } from "../services/cache.ts"
import { config } from "../services/config.ts"
import { db, sql } from "../services/db.ts"
import { eventBus } from "../services/eventBus.ts"
import { log } from "../services/log.ts"

/** The invitation limits, over Valkey like the auth limits. The routes mount two of them. */
export const invitationRateLimits = createInvitationRateLimits({
  ...config.rateLimiter,
  store: (keyPrefix) => createRedisRateLimitStore(kv, { keyPrefix }),
})

/**
 * What the invitation handlers run on. The member cap of an accept is read here, for the group the
 * invitation names, the way the entitlement gate reads it for a create.
 */
export const invitationDependencies: InvitationHandlerDependencies = {
  invitations: new PostgresInvitationRepository(sql),
  ownerOf: (email) => provenAddressOwner(db.authStore, email),
  allowanceOf: async (groupId) =>
    billingSetup.provider === null
      ? null
      : entitlementsOf(effectivePlanId(await db.billing.get(groupId)), true).limits.maxMembers,
  mail: {
    sender: createMailSender(readMailSetup(Deno.env), sql),
    brand: { webAppUrl: config.webAppUrl },
    byAddress: invitationRateLimits.mailByAddress,
    log,
  },
  emit: (event) => eventBus.emit(event),
}
