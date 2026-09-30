/// <reference lib="deno.ns" />
/**
 * Generates VAPID keys for Web Push and writes them to infra/configs/vapid.json,
 * which compose bind-mounts into the API container as /app/vapid.json.
 *
 * Runs the same `@negrel/webpush` version the API imports (pinned in deno.jsonc as `webpush`),
 * so the file is always in the format the API reads. Nothing is fetched from a moving branch.
 */
import * as webpush from "webpush"

const OUTPUT_PATH = "infra/configs/vapid.json"

const keys = await webpush.generateVapidKeys({ extractable: true })
const exported = await webpush.exportVapidKeys(keys)

await Deno.writeTextFile(OUTPUT_PATH, JSON.stringify(exported))
console.log(`VAPID keys written to ${OUTPUT_PATH}`)
