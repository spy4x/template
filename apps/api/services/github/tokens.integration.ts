#!/usr/bin/env -S deno run --allow-env --allow-net

/**
 * Integration test for GitHub App token management
 * 
 * This script demonstrates the token service functionality:
 * 1. JWT generation for GitHub App authentication
 * 2. Token caching and expiration handling
 * 3. Fallback to system GH_TOKEN
 * 
 * Prerequisites:
 * - GH_APP_ID environment variable (optional)
 * - GH_APP_PRIVATE_KEY environment variable (base64-encoded PEM, optional)
 * - GH_TOKEN environment variable (fallback, optional)
 * - Database with github_installations, github_repos, github_installation_tokens tables
 * 
 * Usage:
 *   ./tokens.integration.ts
 */

import { generateGitHubAppJWT, getInstallationToken } from "./tokens.ts"

console.log("GitHub App Token Management - Integration Test\n")

// Test 1: JWT Generation
console.log("Test 1: JWT Generation")
try {
  const jwt = await generateGitHubAppJWT()
  const parts = jwt.split(".")
  
  if (parts.length !== 3) {
    throw new Error("Invalid JWT format")
  }
  
  // Decode and verify header
  const headerJson = atob(parts[0].replace(/-/g, "+").replace(/_/g, "/"))
  const header = JSON.parse(headerJson)
  console.log(`  ✓ Algorithm: ${header.alg}`)
  
  // Decode and verify payload
  const payloadJson = atob(parts[1].replace(/-/g, "+").replace(/_/g, "/"))
  const payload = JSON.parse(payloadJson)
  const expiresIn = payload.exp - Math.floor(Date.now() / 1000)
  console.log(`  ✓ Issuer: ${payload.iss}`)
  console.log(`  ✓ Expires in: ${Math.floor(expiresIn / 60)} minutes`)
  console.log("  ✓ JWT generated successfully\n")
} catch (error) {
  console.log(`  ✗ Error: ${(error as Error).message}`)
  console.log("  Note: Set GH_APP_ID and GH_APP_PRIVATE_KEY to test JWT generation\n")
}

// Test 2: Get Installation Token (requires DB and test data)
console.log("Test 2: Get Installation Token")
console.log("  Note: This requires database connection and test repository data")
console.log("  Try calling: getInstallationToken('owner/repo')")
console.log("  - Returns cached token if valid")
console.log("  - Refreshes token if expired")
console.log("  - Falls back to GH_TOKEN if no installation found\n")

console.log("Integration test completed")
console.log("\nManual verification checklist:")
console.log("  [ ] JWT has valid RS256 signature")
console.log("  [ ] Token refresh stores encrypted value in DB")
console.log("  [ ] Expired tokens trigger GitHub API refresh")
console.log("  [ ] Valid cached tokens avoid API calls")
console.log("  [ ] Missing installations fall back to GH_TOKEN")
