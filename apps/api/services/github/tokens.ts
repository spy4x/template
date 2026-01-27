import { config } from "@api/services/config.ts"
import { encrypt, decrypt } from "../crypto.ts"
import { db } from "../db.ts"

/**
 * GitHub App JWT payload
 */
interface GitHubAppJWTPayload {
  iat: number
  exp: number
  iss: string
}

/**
 * GitHub Installation Token Response
 */
interface GitHubInstallationTokenResponse {
  token: string
  expires_at: string
  permissions?: Record<string, string>
  repository_selection?: string
}



/**
 * Generates a JWT for GitHub App authentication
 * Valid for 10 minutes
 */
export async function generateGitHubAppJWT(): Promise<string> {
  const { appId, appPrivateKey } = config.github

  if (!appId || !appPrivateKey) {
    throw new Error("GitHub App credentials not configured")
  }

  // Decode base64-encoded PEM private key
  const privateKeyPEM = atob(appPrivateKey)

  // Parse PEM to extract raw key
  const pemLines = privateKeyPEM
    .split("\n")
    .filter((line) => !line.includes("BEGIN") && !line.includes("END"))
    .join("")

  const keyData = Uint8Array.from(atob(pemLines), (c) => c.charCodeAt(0))

  // Import RSA private key
  const cryptoKey = await crypto.subtle.importKey(
    "pkcs8",
    keyData,
    {
      name: "RSASSA-PKCS1-v1_5",
      hash: "SHA-256",
    },
    false,
    ["sign"],
  )

  // Create JWT payload
  const now = Math.floor(Date.now() / 1000)
  const payload: GitHubAppJWTPayload = {
    iat: now - 60, // Issued 60 seconds in the past to account for clock skew
    exp: now + 10 * 60, // Expires in 10 minutes
    iss: appId,
  }

  // Create JWT header and payload with proper base64url encoding
  const header = { alg: "RS256", typ: "JWT" }
  const encoder = new TextEncoder()
  
  const encodedHeader = btoa(
    String.fromCharCode(...encoder.encode(JSON.stringify(header)))
  )
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=/g, "")
  
  const encodedPayload = btoa(
    String.fromCharCode(...encoder.encode(JSON.stringify(payload)))
  )
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=/g, "")

  // Sign
  const signatureInput = `${encodedHeader}.${encodedPayload}`
  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    cryptoKey,
    encoder.encode(signatureInput),
  )

  // Encode signature with proper base64url encoding
  let binary = ""
  const signatureBytes = new Uint8Array(signature)
  for (let i = 0; i < signatureBytes.length; i++) {
    binary += String.fromCharCode(signatureBytes[i])
  }
  const encodedSignature = btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=/g, "")

  return `${signatureInput}.${encodedSignature}`
}

/**
 * Refreshes an installation token from GitHub API
 */
export async function refreshInstallationToken(installationId: number): Promise<string> {
  if (!installationId || installationId <= 0) {
    throw new Error("Invalid installation ID")
  }

  const jwt = await generateGitHubAppJWT()

  // Call GitHub API to get installation token
  const response = await fetch(
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

  if (!response.ok) {
    const error = await response.text()
    console.error(`GitHub API error for installation ${installationId}:`, error)
    throw new Error(`Failed to refresh installation token: ${response.status}`)
  }

  const data: GitHubInstallationTokenResponse = await response.json()

  // Store encrypted token in DB
  const encryptedToken = await encrypt(data.token)
  const expiresAt = new Date(data.expires_at)

  // Find our internal installation record
  const installation = await db.githubInstallation.findByInstallationId(installationId)

  if (!installation) {
    throw new Error(`Installation ${installationId} not found`)
  }

  // Upsert token
  await db.githubInstallationToken.upsert({
    installationId: installation.id,
    token: encryptedToken,
    expiresAt,
  })

  return data.token
}

/**
 * Gets installation token for a repository
 * Returns cached token if valid, otherwise refreshes
 * Falls back to GH_TOKEN env var if no installation found
 */
export async function getInstallationToken(repoFullName: string): Promise<string> {
  // Find repo and installation
  const repo = await db.githubRepo.findByFullName(repoFullName)

  if (!repo) {
    // Fallback to system GH_TOKEN
    const systemToken = Deno.env.get("GH_TOKEN")
    if (!systemToken) {
      throw new Error(`No installation found for ${repoFullName} and GH_TOKEN not set`)
    }
    return systemToken
  }

  const installation = await db.githubInstallation.findByInstallationId(repo.installationId)

  if (!installation) {
    throw new Error(`Installation not found for repo ${repoFullName}`)
  }

  // Check for cached token (use internal installation.id, not GitHub's installationId)
  const cachedToken = await db.githubInstallationToken.findByInstallationId(installation.id)

  const now = new Date()

  // If token exists and expires in more than 5 minutes, use it
  if (cachedToken) {
    const expiresIn = cachedToken.expiresAt.getTime() - now.getTime()
    const fiveMinutes = 5 * 60 * 1000

    if (expiresIn > fiveMinutes) {
      return await decrypt(cachedToken.token)
    }
  }

  // Refresh token
  return await refreshInstallationToken(installation.installationId)
}
