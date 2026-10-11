import type postgres from "postgres"
import { API_TOKEN_PURGE_GRACE_DAYS } from "@domain/api-tokens"

/** The `audit_events.event_kind` of a purge run that deleted at least one token. */
export const API_TOKENS_PURGED_EVENT = `api_tokens.expired_purged`

/**
 * Deletes every personal API token that expired more than `days` ago (30 by default,
 * {@link API_TOKEN_PURGE_GRACE_DAYS}) and returns how many. It runs in the worker's nightly
 * cleanup. An expired token is refused and hidden from its owner's list from the moment it
 * expires; this removes its row, and with it the hash. A token that never expires has no expiry to
 * count from and stays. A revoked token needs no purge: revoking deletes its row at once.
 *
 * A run that deleted at least one token writes one `audit_events` row of kind
 * {@link API_TOKENS_PURGED_EVENT}, with no actor and no group, so no group's activity log shows
 * it. Its details hold the number of tokens deleted and the cutoff the run used, and nothing of a
 * token: no id, name, hash or owner. The delete and the row are one statement, so both are kept or
 * neither is.
 *
 * It uses the clock of the database, as the check that refuses an expired token does. A token that
 * expired exactly `days` ago stays until the next run.
 */
export async function purgeExpiredApiTokens(
  sql: postgres.Sql,
  days: number = API_TOKEN_PURGE_GRACE_DAYS,
): Promise<number> {
  const [row] = await sql<{ count: number }[]>`
    WITH cutoff AS (
      SELECT now() - make_interval(days => ${days}) AS at
    ),
    removed AS (
      DELETE FROM api_tokens USING cutoff WHERE api_tokens.expires_at < cutoff.at RETURNING 1
    )
    INSERT INTO audit_events (event_kind, details)
    SELECT ${API_TOKENS_PURGED_EVENT}, jsonb_build_object(
      'count', count(*),
      'cutoff', to_char((SELECT at FROM cutoff) AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
    )
    FROM removed
    HAVING count(*) > 0
    RETURNING (details->>'count')::int AS count
  `
  return row?.count ?? 0
}
