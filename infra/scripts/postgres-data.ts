/// <reference lib="deno.ns" />
/**
 * Where Postgres keeps its data on the host, and the check that stops `deno task compose` from
 * starting Postgres 18 empty beside a Postgres 16 data directory that was never moved over.
 *
 * Postgres 18 cannot open a version 16 data directory, so the Compose file gives it a directory
 * of its own. Without this check a deploy on a server that still has the old directory would
 * start an empty database, run the migrations on it and serve it. The only way from the old
 * directory to the new one is `deno task db:upgrade-18` (docs/postgres-18-upgrade.md), which
 * writes {@link UPGRADE_MARKER} into the new directory once the row counts match.
 *
 * @module
 */

/** Host directory of the Postgres 16 container, as the Compose file named it before the move. */
export const OLD_DATA_DIR = `./.volumes/postgres`
/** Host directory of the Postgres 18 container: `infra/compose/compose.shared.yml` mounts it. */
export const NEW_DATA_DIR = `./.volumes/postgres18`
/** File name, inside the new directory, that says its data came from the old one. */
export const UPGRADE_MARKER = `upgraded-from-16`

/** What is on the host's disk; read by {@link readPostgresDataFacts}. */
export interface PostgresDataFacts {
  /** The Postgres 16 directory is still there. */
  oldDataExists: boolean
  /** The Postgres 18 directory is there, filled or not. */
  newDataExists: boolean
  /** The upgrade finished: the marker is in the Postgres 18 directory. */
  upgradeMarked: boolean
}

/** Compose commands that can start the database. */
const STARTING_COMMANDS = [`up`, `start`, `restart`, `run`, `create`]

/**
 * The reason `deno task compose <args>` must not run, or `undefined` when it may. It refuses a
 * command that can start the database while the old directory exists and the upgrade has not
 * finished. A machine with no old directory (a fresh install) and one whose owner removed it
 * after the upgrade are never refused, and neither is a command that starts nothing (`ps`,
 * `logs`, `stop`, `down`, `build`).
 */
export function postgresUpgradeRefusal(
  args: string[],
  facts: PostgresDataFacts,
): string | undefined {
  if (!facts.oldDataExists || facts.upgradeMarked) return undefined
  if (!args.some((arg) => STARTING_COMMANDS.includes(arg))) return undefined
  return [
    `Refusing to start: ${OLD_DATA_DIR} holds a Postgres 16 database, and Postgres 18 keeps its`,
    `data in ${NEW_DATA_DIR}. Starting now would serve an empty database. Nothing was changed.`,
    `- To move the data: deno task db:upgrade-18 (docs/postgres-18-upgrade.md).`,
    `- On a development machine whose data you do not need: move or delete ${OLD_DATA_DIR}.`,
  ].join(`\n`)
}

async function exists(path: string): Promise<boolean> {
  try {
    await Deno.stat(path)
    return true
  } catch (error) {
    // The container's user owns the directories, so a file inside may be unreadable to the person
    // who deploys. An unreadable marker counts as missing: the check refuses instead of guessing.
    if (error instanceof Deno.errors.NotFound || error instanceof Deno.errors.PermissionDenied) {
      return false
    }
    throw error
  }
}

/** Reads the facts from the working directory, which every script takes to be the app's root. */
export async function readPostgresDataFacts(): Promise<PostgresDataFacts> {
  return {
    oldDataExists: await exists(OLD_DATA_DIR),
    newDataExists: await exists(NEW_DATA_DIR),
    upgradeMarked: await exists(`${NEW_DATA_DIR}/${UPGRADE_MARKER}`),
  }
}
