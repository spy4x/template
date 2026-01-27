import { Hono } from "hono"
import type { Context } from "hono"
import { APIContext } from "../_types.ts"
import { verifyWebhookSignature } from "@api/services/github/verify.ts"
import { log } from "@api/services/log.ts"
import { db } from "@api/services/db.ts"
import { handleGithubEvent } from "@api/services/github/handler.ts"

export const githubRoute = new Hono<APIContext>()
  .post("/webhook", async (c: Context<APIContext>) => {
    console.log("🔔 GitHub webhook received")
    const body = await c.req.text()
    const signature = c.req.header("x-hub-signature-256")
    const ok = await verifyWebhookSignature(signature, body)
    if (!ok) {
      console.log("❌ Webhook signature verification failed")
      return c.json({ error: "invalid signature" }, 401)
    }
    console.log("✅ Webhook signature verified")
    let payload: Record<string, unknown>
    try {
      payload = JSON.parse(body)
    } catch {
      console.log("❌ Invalid JSON in webhook payload")
      return c.json({ error: "invalid json" }, 400)
    }
    const event = c.req.header("x-github-event") || "unknown"
    const deliveryId = c.req.header("x-github-delivery") || ""
    if (!deliveryId) {
      console.log("❌ Missing delivery ID in webhook")
      return c.json({ error: "missing delivery id" }, 400)
    }
    const action = (payload.action as string | undefined) ?? null
    const repoFullName =
      (payload.repository as { full_name?: string } | undefined)?.full_name ?? null
    console.log(`📝 Processing webhook inline: ${event}/${action} from ${repoFullName}`)
    
    // Process webhook immediately (no queue)
    handleGithubEvent({
      webhookEventId: 0,
      deliveryId,
      event,
      action,
      repoFullName,
      payload,
    }).catch(err => {
      console.error("❌ Error processing webhook:", err)
    })
    
    log("github webhook", event, action ?? "")
    return c.json({ accepted: true })
  })
