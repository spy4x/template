import { db } from "@api/services/db.ts"
import { runGh } from "@api/services/github/cli.ts"
import { config } from "@api/services/config.ts"
import { log } from "@api/services/log.ts"
import {
  GithubActionKind,
  GithubActionStatus,
} from "@api/services/github/types.ts"
import { runOpencode, type OpencodeResult } from "@api/services/github/opencode.ts"
import { ensureWorkspace } from "@api/services/github/workspace.ts"
import { runGit } from "@api/services/github/git.ts"

export type GithubEventInput = {
  webhookEventId: number
  deliveryId: string
  event: string
  action: string | null
  repoFullName: string | null
  payload: Record<string, unknown>
}

export async function handleGithubEvent(input: GithubEventInput): Promise<void> {
  console.log(`🔧 handleGithubEvent: ${input.event}/${input.action}`)
  try {
    if (input.event === "installation") {
      await handleInstallationEvent(input)
      return
    }
    if (input.event === "installation_repositories") {
      await handleInstallationRepositoriesEvent(input)
      return
    }
    if (input.event === "issues") {
      if (!input.repoFullName) return
      if (!config.github.allowAllRepos && config.github.allowedRepos.length &&
        !config.github.allowedRepos.includes(input.repoFullName)) return
      await handleIssueEvent(input)
      return
    }
    console.log(`ℹ️  Ignored event: ${input.event}`)
  } catch (error) {
    console.error("❌ Error handling GitHub event:", error)
    throw error
  }
}

async function handleInstallationEvent(input: GithubEventInput): Promise<void> {
  const action = input.action
  console.log(`🔧 Installation event: action=${action}`)
  
  try {
    const installation = input.payload.installation as {
      id?: number
      account?: { login?: string; type?: string }
      repository_selection?: string
    } | undefined
    
    if (!installation?.id) {
      console.log("⚠️  Missing installation.id in payload")
      return
    }
    
    const installationId = installation.id
    const accountLogin = installation.account?.login ?? ""
    const accountTypeStr = installation.account?.type ?? "User"
    const accountType = accountTypeStr === "Organization" ? 2 : 1
    const reposAccessStr = installation.repository_selection ?? "all"
    const reposAccess = reposAccessStr === "selected" ? 2 : 1
    
    if (action === "created") {
      console.log(`➕ Installation created: ${installationId} (${accountLogin})`)
      
      // No user_id available in webhook - will link later via OAuth callback
      const result = await db.githubInstallation.upsert({
        userId: null,
        installationId,
        accountLogin,
        accountType,
        reposAccess,
      })
      
      if (!result) {
        console.log(`ℹ️  Installation ${installationId} queued for linking via OAuth`)
        return
      }
      
      // Upsert repositories if present
      const repositories = input.payload.repositories as Array<{
        id?: number
        full_name?: string
        private?: boolean
      }> | undefined
      
      if (repositories?.length) {
        console.log(`📦 Adding ${repositories.length} repos to installation ${result.id}`)
        for (const repo of repositories) {
          if (repo.id && repo.full_name) {
            await db.githubRepo.upsert({
              installationId: result.id,
              repoId: repo.id,
              repoFullName: repo.full_name,
              private: repo.private ?? false,
            })
          }
        }
      }
      
      console.log(`✅ Installation ${installationId} processed`)
    } else if (action === "deleted") {
      console.log(`🗑️  Installation deleted: ${installationId}`)
      await db.githubInstallation.suspendByInstallationId(installationId)
      console.log(`✅ Installation ${installationId} suspended`)
    }
  } catch (error) {
    console.error(`❌ Error handling installation event:`, error)
    throw error
  }
}

async function handleInstallationRepositoriesEvent(input: GithubEventInput): Promise<void> {
  const action = input.action
  console.log(`📦 Installation repositories event: action=${action}`)
  
  try {
    const installation = input.payload.installation as {
      id?: number
    } | undefined
    
    if (!installation?.id) {
      console.log("⚠️  Missing installation.id in payload")
      return
    }
    
    const installationId = installation.id
    
    // Find our internal installation record
    const installationRecord = await db.githubInstallation.findByInstallationId(installationId)
    
    if (!installationRecord) {
      console.log(`⚠️  Installation ${installationId} not found in DB`)
      return
    }
    
    if (action === "added") {
      const repositories = input.payload.repositories_added as Array<{
        id?: number
        full_name?: string
        private?: boolean
      }> | undefined
      
      if (repositories?.length) {
        console.log(`➕ Adding ${repositories.length} repos to installation ${installationRecord.id}`)
        for (const repo of repositories) {
          if (repo.id && repo.full_name) {
            await db.githubRepo.upsert({
              installationId: installationRecord.id,
              repoId: repo.id,
              repoFullName: repo.full_name,
              private: repo.private ?? false,
            })
          }
        }
        console.log(`✅ Added ${repositories.length} repos`)
      }
    } else if (action === "removed") {
      const repositories = input.payload.repositories_removed as Array<{
        id?: number
        full_name?: string
      }> | undefined
      
      if (repositories?.length) {
        console.log(`➖ Removing ${repositories.length} repos from installation ${installationRecord.id}`)
        for (const repo of repositories) {
          if (repo.id) {
            await db.githubRepo.deleteByRepoId(repo.id)
          }
        }
        console.log(`✅ Removed ${repositories.length} repos`)
      }
    }
  } catch (error) {
    console.error(`❌ Error handling installation_repositories event:`, error)
    throw error
  }
}

async function handleIssueEvent(input: GithubEventInput): Promise<void> {
  const issueNumber = Number((input.payload.issue as { number?: number } | undefined)?.number)
  if (!issueNumber || !input.repoFullName) return
  
  const action = input.action
  console.log(`📋 Issue event: action=${action}, issue=${issueNumber}`)
  
  // Handle labeled/unlabeled events
  if (action === "labeled" || action === "unlabeled") {
    const label = (input.payload.label as { name?: string } | undefined)?.name
    if (!label) return
    
    console.log(`🏷️  Label ${action}: ${label}`)
    
    if (action === "labeled") {
      if (label === "in-progress") {
        console.log(`🚀 Triggering AI work for issue #${issueNumber}`)
        await processIssueRun(input.repoFullName, issueNumber)
      } else if (label === "done") {
        console.log(`✅ Merging PR for issue #${issueNumber}`)
        await mergeLatestPr(input.repoFullName, issueNumber)
      }
    }
    return
  }
  
  // Other issue actions logged but not processed
  console.log(`ℹ️  Issue ${action}, no label trigger`)
}

async function processIssueRun(
  repoFullName: string,
  issueNumber: number,
): Promise<void> {
  console.log(`🏃 processIssueRun: ${repoFullName}#${issueNumber}`)
  
  if (!config.github.ghCliEnabled || config.github.ghCliDryRun) {
    await appendIssueAudit(repoFullName, issueNumber, "gh cli disabled or dry-run.")
    return
  }
  const lastRun = await db.githubActionRun.findLatestByIssue({
    repoFullName,
    issueNumber,
  })
  if (lastRun?.status === GithubActionStatus.QUEUED) {
    await appendIssueAudit(repoFullName, issueNumber, "Run already queued.")
    return
  }
  const actionRun = await db.githubActionRun.createOne({
    webhookEventId: null,
    actionKind: GithubActionKind.OPENCODE,
    command: "opencode",
    args: { repoFullName, issueNumber },
    status: GithubActionStatus.RUNNING,
  })
  console.log(`📥 Fetching issue context for #${issueNumber}`)
  const issue = await getIssueContext(repoFullName, issueNumber)
  if (!issue) {
    await appendIssueAudit(repoFullName, issueNumber, "Failed to fetch issue context.")
    return
  }
  console.log(`📂 Preparing workspace for ${repoFullName}`)
  const workspace = await ensureWorkspace(repoFullName)
  const branch = `ai/issue-${issueNumber}`
  await prepareRepo(workspace.path, repoFullName, branch)
  
  const prompt = `Fix issue #${issueNumber} in ${repoFullName}:\n\n${issue}`
  console.log(`🤖 Running OpenCode with prompt: ${prompt.substring(0, 100)}...`)
  
  // Set timeout for OpenCode execution (5 minutes max)
  const timeoutMs = 5 * 60 * 1000
  const timeoutPromise = new Promise<OpencodeResult>((_, reject) =>
    setTimeout(() => reject(new Error("OpenCode timeout after 5 minutes")), timeoutMs)
  )
  
  const opencodePromise = runOpencode(
    ["run", "--format=json", prompt],
    workspace.path,
    {
      OPENCODE_REPO: repoFullName,
      OPENCODE_ISSUE: String(issueNumber),
    }
  )
  
  const opencodeResult = await Promise.race([opencodePromise, timeoutPromise]).catch((err) => ({
    ok: false,
    code: 1,
    stdout: "",
    stderr: `OpenCode execution failed: ${err.message}`,
  }))
  
  // Log OpenCode output
  if (opencodeResult.stdout) console.log(`📋 OpenCode stdout:\n${opencodeResult.stdout}`)
  if (opencodeResult.stderr) console.log(`⚠️  OpenCode stderr:\n${opencodeResult.stderr}`)
  console.log(`🔍 OpenCode exit code: ${opencodeResult.code}`)
  
  await db.githubActionRun.updateOne({
    id: actionRun.id,
    status: opencodeResult.ok ? GithubActionStatus.SUCCESS : GithubActionStatus.FAILED,
    stdout: opencodeResult.stdout,
    stderr: opencodeResult.stderr,
  })
  if (!opencodeResult.ok) {
    await appendIssueAudit(repoFullName, issueNumber, "Opencode failed; check logs.")
    await db.githubActionRun.updateOne({
      id: actionRun.id,
      status: GithubActionStatus.FAILED,
      stdout: opencodeResult.stdout,
      stderr: opencodeResult.stderr,
    })
    return
  }
  console.log(`💾 Committing changes...`)
  const committed = await commitIfNeeded(workspace.path, issueNumber)
  if (!committed) {
    await appendIssueAudit(repoFullName, issueNumber, "No changes detected.")
    await db.githubActionRun.updateOne({
      id: actionRun.id,
      status: GithubActionStatus.SUCCESS,
      stdout: opencodeResult.stdout,
      stderr: opencodeResult.stderr,
    })
    return
  }
  console.log(`📤 Creating/updating PR...`)
  const prUrl = await createOrUpdatePr(repoFullName, branch, issueNumber)
  await appendIssueAudit(
    repoFullName,
    issueNumber,
    `Opencode done. PR: ${prUrl}`,
  )
  await db.githubActionRun.updateOne({
    id: actionRun.id,
    status: GithubActionStatus.SUCCESS,
    stdout: opencodeResult.stdout,
    stderr: opencodeResult.stderr,
  })
  
  // Swap label: in-progress -> problem (AI completed work, needs human review)
  console.log(`🏷️  Swapping label: in-progress -> problem`)
  await runGh([
    "issue",
    "edit",
    String(issueNumber),
    "--repo",
    repoFullName,
    "--add-label",
    "problem",
    "--remove-label",
    "in-progress",
  ])
}

async function prepareRepo(path: string, repoFullName: string, branch: string): Promise<void> {
  const exists = await runGit(["-C", path, "rev-parse", "--git-dir"]).then((r) => r.ok)
  if (!exists) {
    await runGh(["repo", "clone", repoFullName, path])
  }
  
  // Configure git user for this repo
  await runGit(["-C", path, "config", "user.name", "Tampines AI"])
  await runGit(["-C", path, "config", "user.email", "ai@seedsaas.com"])
  
  await runGit(["-C", path, "fetch", "origin"]).then(() => undefined)
  
  // Check if origin/main exists (empty repos won't have it)
  const hasMain = await runGit(["-C", path, "rev-parse", "--verify", "origin/main"]).then((r) => r.ok)
  
  if (hasMain) {
    await runGit(["-C", path, "checkout", "-B", branch, "origin/main"]).then(() => undefined)
  } else {
    // New empty repo - create orphan branch
    await runGit(["-C", path, "checkout", "--orphan", branch]).then(() => undefined)
  }
}

async function getIssueContext(repoFullName: string, issueNumber: number): Promise<string> {
  const result = await runGh([
    "issue",
    "view",
    String(issueNumber),
    "--repo",
    repoFullName,
    "--json",
    "title,body,comments",
  ])
  return result.ok ? result.stdout : ""
}

async function createOrUpdatePr(repoFullName: string, branch: string, issueNumber: number): Promise<string> {
  const path = `${config.github.workspaceRoot}/${repoFullName.replace(/\W+/g, "-")}`
  
  console.log(`🚀 Pushing branch ${branch} to origin...`)
  const pushResult = await runGit(["-C", path, "push", "-u", "origin", branch])
  if (!pushResult.ok) {
    console.error(`❌ Git push failed: ${pushResult.stderr}`)
    return ""
  }
  console.log(`✅ Push successful`)
  
  const prResult = await runGh([
    "pr",
    "create",
    "--repo",
    repoFullName,
    "--head",
    branch,
    "--base",
    "main",
    "--title",
    `AI: issue #${issueNumber}`,
    "--body",
    `Auto-generated for issue #${issueNumber}`,
  ])
  if (prResult.ok) {
    console.log(`✅ PR created: ${prResult.stdout.trim()}`)
    return prResult.stdout.trim()
  }
  
  console.log(`⚠️  PR create failed, checking if PR already exists...`)
  const list = await runGh([
    "pr",
    "list",
    "--repo",
    repoFullName,
    "--head",
    branch,
    "--json",
    "number,url",
  ])
  if (!list.ok) {
    console.error(`❌ Failed to list PRs: ${list.stderr}`)
    return ""
  }
  const data = JSON.parse(list.stdout)
  const prNumber = data[0]?.number
  if (prNumber) {
    console.log(`📝 Updating existing PR #${prNumber}`)
    await runGh([
      "pr",
      "edit",
      String(prNumber),
      "--repo",
      repoFullName,
      "--title",
      `AI: issue #${issueNumber}`,
      "--body",
      `Auto-generated for issue #${issueNumber}`,
    ])
  }
  return data[0]?.url ?? ""
}

async function commitIfNeeded(path: string, issueNumber: number): Promise<boolean> {
  const status = await runGit(["-C", path, "status", "--porcelain"])
  if (!status.ok || !status.stdout.trim()) return false
  await runGit(["-C", path, "add", "-A"])
  const message = `ai: issue #${issueNumber}`
  const commit = await runGit(["-C", path, "commit", "-m", message])
  if (!commit.ok) {
    console.error(`❌ Git commit failed: ${commit.stderr}`)
  }
  return commit.ok
}

async function appendIssueAudit(repoFullName: string, issueNumber: number, message: string): Promise<void> {
  await runGh([
    "issue",
    "comment",
    String(issueNumber),
    "--repo",
    repoFullName,
    "--body",
    message,
  ])
}

async function mergeLatestPr(repoFullName: string, issueNumber: number): Promise<void> {
  console.log(`🔀 Merging PR for issue #${issueNumber}`)
  const list = await runGh([
    "pr",
    "list",
    "--repo",
    repoFullName,
    "--search",
    `AI: issue #${issueNumber}`,
    "--json",
    "number",
  ])
  if (!list.ok) return
  const data = JSON.parse(list.stdout)
  if (!data?.length) return
  const prNumber = data[0].number
  await runGh([
    "pr",
    "merge",
    String(prNumber),
    "--repo",
    repoFullName,
    "--merge",
    "--delete-branch",
  ])
  console.log(`✅ PR #${prNumber} merged and branch deleted`)
}
