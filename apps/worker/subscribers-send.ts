/// <reference lib="deno.ns" />
/**
 * Queues one issue for a mailing list: `deno task subscribers:send <list> <issue.json | ->`, run in
 * the worker container (`docker exec -i <worker> deno task subscribers:send news - < issue.json`).
 * The issue's shape is `subscriberIssueSchema` (libs/server/jobs/subscriber-issue.ts). The worker's
 * `subscribers.send-issue` job then mails it; running the same issue again mails only the
 * subscribers the earlier runs missed.
 */
import postgres from "postgres"
import { type } from "arktype"
import { createSqlFromEnv } from "@spy4x/server/db"
import { isSubscriberList, SUBSCRIBER_LISTS } from "@domain/subscribers"
import {
  queueSubscriberIssue,
  renderSubscriberIssue,
  subscriberIssueSchema,
} from "@server/jobs/subscriber-issue.ts"

const [list, path] = Deno.args
if (!isSubscriberList(list) || !path) {
  console.error(
    `usage: deno task subscribers:send <${SUBSCRIBER_LISTS.join("|")}> <issue.json | ->`,
  )
  Deno.exit(2)
}
const domain = Deno.env.get("DOMAIN")
if (!domain) {
  console.error("❌ Missing environment variable: DOMAIN")
  Deno.exit(1)
}

const raw = path === "-"
  ? await new Response(Deno.stdin.readable).text()
  : await Deno.readTextFile(path)
let parsed: unknown
try {
  parsed = JSON.parse(raw)
} catch {
  console.error("❌ The issue is not valid JSON")
  Deno.exit(1)
}
const issue = subscriberIssueSchema(parsed)
if (issue instanceof type.errors) {
  console.error(`❌ The issue is not valid: ${issue.summary}`)
  Deno.exit(1)
}

const sql = createSqlFromEnv(Deno.env.toObject(), {
  transform: postgres.camel,
  applicationName: "subscribers-send",
  // sendIssue runs in the worker; this only writes two rows.
  max: 1,
})
if (!sql) {
  console.error("❌ Missing environment variable: DB_HOST")
  Deno.exit(1)
}
try {
  const brand = { webAppUrl: `http${Deno.env.get("ENV") === "dev" ? "" : "s"}://${domain}` }
  await queueSubscriberIssue(sql, list, renderSubscriberIssue(brand, issue))
  console.log(`Queued issue ${issue.id} for the ${list} list; the worker sends it`)
} finally {
  await sql.end()
}
