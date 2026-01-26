import { db } from "@api/services/db.ts"
import { handleGithubEvent } from "@api/services/github/handler.ts"
import { GithubWebhookStatus } from "@api/services/github/types.ts"

async function verifyGithubCLI() {
  const token = Deno.env.get("GH_TOKEN")
  if (!token) {
    console.warn("⚠️  GH_TOKEN not set, gh CLI will not be authenticated")
    return
  }

  try {
    // gh CLI automatically uses GH_TOKEN env var, just verify it works
    const process = new Deno.Command("gh", {
      args: ["auth", "status"],
      stdout: "piped",
      stderr: "piped",
    })
    const { code } = await process.output()
    
    if (code === 0) {
      console.log("✅ GitHub CLI authenticated via GH_TOKEN")
    } else {
      console.error("❌ GitHub CLI authentication failed")
    }
  } catch (err) {
    console.error("❌ Error checking gh CLI:", err)
  }
}

async function verifyOpenCode() {
  try {
    const process = new Deno.Command("opencode", {
      args: ["--version"],
      stdout: "piped",
      stderr: "piped",
    })
    const { code, stdout } = await process.output()
    
    if (code === 0) {
      const version = new TextDecoder().decode(stdout).trim()
      console.log(`✅ OpenCode installed: ${version}`)
    } else {
      console.error("❌ OpenCode not found or not working")
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    console.error("❌ OpenCode not available:", message)
  }
}

export async function runWebhookWorkerOnce(limit = 10): Promise<number> {
  const batch = await db.githubWebhookEvent.claimBatch({ limit })
  if (!batch.length) {
    console.log(`⏳ Polling... (no events)`)
    return 0
  }
  console.log(`📥 Processing ${batch.length} webhook events...`)
  for (const event of batch) {
    console.log(`🔧 Processing event ${event.id}: ${event.event}/${event.action} from ${event.repoFullName}`)
    await handleGithubEvent({
      webhookEventId: event.id,
      deliveryId: event.deliveryId,
      event: event.event,
      action: event.action,
      repoFullName: event.repoFullName,
      payload: event.payload as Record<string, unknown>,
    })
  }
  return batch.length
}

export async function runWebhookWorkerLoop(intervalMs = 1000): Promise<void> {
  // deno-lint-ignore no-constant-condition
  while (true) {
    await runWebhookWorkerOnce(25)
    await new Promise((resolve) => setTimeout(resolve, intervalMs))
  }
}

if (import.meta.main) {
  console.log("🚀 Starting GitHub webhook worker...")
  await verifyGithubCLI()
  await verifyOpenCode()
  console.log("🔄 Starting polling loop (every 1s)...")
  await runWebhookWorkerLoop(1000)
}
