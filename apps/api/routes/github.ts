import { Hono } from "hono"
import type { Context } from "hono"
import { APIContext } from "../_types.ts"
import { verifyWebhookSignature } from "@api/services/github/verify.ts"
import { log } from "@api/services/log.ts"
import { db } from "@api/services/db.ts"
import { handleGithubEvent } from "@api/services/github/handler.ts"
import { isAuthenticated2FA } from "@api/middlewares/auth-guards.ts"
import { config } from "@api/services/config.ts"
import { randomBytes } from "node:crypto"
import { generateGitHubAppJWT } from "@api/services/github/tokens.ts"

export const githubRoute = new Hono<APIContext>()
  .get("/installations", isAuthenticated2FA, async (c: Context<APIContext>) => {
    const auth = c.get("auth")
    const installations = await db.githubInstallation.findByUserId(auth.user.id)
    return c.json({ installations })
  })
  .get("/repos", isAuthenticated2FA, async (c: Context<APIContext>) => {
    const auth = c.get("auth")
    const repos = await db.githubRepo.findByUserId(auth.user.id)
    return c.json({ repos })
  })
  .delete("/installations/:id", isAuthenticated2FA, async (c: Context<APIContext>) => {
    const auth = c.get("auth")
    const id = parseInt(c.req.param("id"))
    
    if (isNaN(id)) {
      return c.json({ error: "Invalid installation id" }, 400)
    }
    
    // Verify ownership
    const installations = await db.githubInstallation.findByUserId(auth.user.id)
    const installation = installations.find((i) => i.id === id)
    
    if (!installation) {
      return c.json({ error: "Installation not found or not owned by user" }, 403)
    }
    
    await db.githubInstallation.suspend(id)
    log("github installation suspended", auth.user.id.toString(), id.toString())
    
    return c.json({ success: true })
  })
  .get("/connect", isAuthenticated2FA, async (c: Context<APIContext>) => {
    // Generate CSRF state token
    const state = randomBytes(32).toString("hex")
    
    // Store state in session/cookie for verification on callback
    // For now, we'll include it as a param - the callback handler should verify it
    const auth = c.get("auth")
    // TODO: Store state in KV/session storage with expiry
    
    const appSlug = config.github.appSlug
    const redirectUrl = `https://github.com/apps/${appSlug}/installations/new?state=${state}`
    
    log("github connect initiated", auth.user.id.toString(), state)
    
    return c.redirect(redirectUrl)
  })
  .get("/oauth/callback", async (c: Context<APIContext>) => {
    // Get user from session
    const authData = c.get("auth")
    if (!authData) {
      return c.redirect(`${config.webAppUrl}/sign-in`)
    }

    // Extract params
    const installationId = c.req.query("installation_id")
    const setupAction = c.req.query("setup_action")

    if (!installationId) {
      console.error("❌ Missing installation_id in OAuth callback")
      return c.redirect(`${config.webAppUrl}/profile?github_error=missing_installation_id`)
    }

    try {
      // Generate JWT for GitHub App
      const jwt = await generateGitHubAppJWT()

      // Fetch installation details
      const installationResponse = await fetch(
        `https://api.github.com/app/installations/${installationId}`,
        {
          headers: {
            "Accept": "application/vnd.github+json",
            "Authorization": `Bearer ${jwt}`,
            "X-GitHub-Api-Version": "2022-11-28",
          },
        },
      )

      if (!installationResponse.ok) {
        const error = await installationResponse.text()
        console.error("❌ Failed to fetch installation:", error)
        return c.redirect(`${config.webAppUrl}/profile?github_error=fetch_installation_failed`)
      }

      const installation = await installationResponse.json()

      // Create installation token to fetch repos
      const tokenResponse = await fetch(
        `https://api.github.com/app/installations/${installationId}/access_tokens`,
        {
          method: "POST",
          headers: {
            "Accept": "application/vnd.github+json",
            "Authorization": `Bearer ${jwt}`,
            "X-GitHub-Api-Version": "2022-11-28",
          },
        },
      )

      if (!tokenResponse.ok) {
        const error = await tokenResponse.text()
        console.error("❌ Failed to create installation token:", error)
        return c.redirect(`${config.webAppUrl}/profile?github_error=token_creation_failed`)
      }

      const tokenData = await tokenResponse.json()
      const installationToken = tokenData.token

      // Fetch repositories
      const reposResponse = await fetch(
        "https://api.github.com/installation/repositories",
        {
          headers: {
            "Accept": "application/vnd.github+json",
            "Authorization": `token ${installationToken}`,
            "X-GitHub-Api-Version": "2022-11-28",
          },
        },
      )

      if (!reposResponse.ok) {
        const error = await reposResponse.text()
        console.error("❌ Failed to fetch repositories:", error)
        return c.redirect(`${config.webAppUrl}/profile?github_error=fetch_repos_failed`)
      }

      const reposData = await reposResponse.json()

      // Determine account type (1=user, 2=organization)
      const accountType = installation.account.type === "User" ? 1 : 2

      // Determine repos access (1=all, 2=selected)
      const reposAccess = installation.repository_selection === "all" ? 1 : 2

      // Upsert installation
      const dbInstallation = await db.githubInstallation.upsert({
        userId: authData.user.id,
        installationId: Number(installationId),
        accountLogin: installation.account.login,
        accountType,
        reposAccess,
      })

      if (!dbInstallation) {
        console.error("❌ Failed to upsert installation")
        return c.redirect(`${config.webAppUrl}/profile?github_error=installation_save_failed`)
      }

      // Upsert repositories
      const repositories = reposData.repositories || []
      for (const repo of repositories) {
        await db.githubRepo.upsert({
          installationId: dbInstallation.id,
          repoId: repo.id,
          repoFullName: repo.full_name,
          private: repo.private,
        })
      }

      console.log(
        `✅ GitHub installation ${installationId} linked for user ${authData.user.id} (${repositories.length} repos)`,
      )

      log("github oauth callback", authData.user.id.toString(), installationId)

      return c.redirect(`${config.webAppUrl}/profile?github_connected=true`)
    } catch (error) {
      console.error("❌ Error in OAuth callback:", error)
      return c.redirect(`${config.webAppUrl}/profile?github_error=unexpected_error`)
    }
  })
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
