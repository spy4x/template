import type { SyncRunner } from "@spy4x/realtime/sync-runner"

/**
 * Starts `runner` once `ready` settles, but only if its layer is still the running one.
 *
 * The library's `start()` re-arms a stopped runner, which would then listen for focus, visibility
 * and reconnects, and retry a flush for a user who has left. So a sign-out or a user switch that
 * comes while the queue is still loading must win.
 *
 * @param runner The runner to start.
 * @param ready Settles when the queue has been read from the device.
 * @param isCurrent Whether the runner's layer is still the running one.
 */
export async function startRunnerWhileCurrent(
  runner: Pick<SyncRunner, `start`>,
  ready: Promise<unknown>,
  isCurrent: () => boolean,
): Promise<void> {
  await ready
  if (isCurrent()) runner.start()
}
