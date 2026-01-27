import { expect } from "@std/expect"

// Set minimal env vars required for config initialization
Deno.env.set("ENV", "dev")
Deno.env.set("AUTH_COOKIE_SECRET", "test-secret")
Deno.env.set("AUTH_PEPPER", "test-pepper-for-encryption")
Deno.env.set("AUTH_TOTP", "test-totp")
Deno.env.set("DEV_EMAIL", "test@example.com")
Deno.env.set("TIMEZONE", "UTC")
Deno.env.set("RATE_LIMITER_WINDOW_MS", "60000")
Deno.env.set("RATE_LIMITER_STRICT_LIMIT", "30")

import { decrypt, encrypt } from "./crypto.ts"

Deno.test("crypto: round-trip encrypt/decrypt returns original", async () => {
  const plaintext = "github_pat_example_token_123"
  const encrypted = await encrypt(plaintext)
  const decrypted = await decrypt(encrypted)
  expect(decrypted).toBe(plaintext)
})

Deno.test("crypto: different encryptions produce different ciphertext", async () => {
  const plaintext = "same_token"
  const encrypted1 = await encrypt(plaintext)
  const encrypted2 = await encrypt(plaintext)

  // Different IV means different ciphertext
  expect(encrypted1).not.toBe(encrypted2)

  // But both decrypt to same value
  expect(await decrypt(encrypted1)).toBe(plaintext)
  expect(await decrypt(encrypted2)).toBe(plaintext)
})

Deno.test("crypto: invalid ciphertext throws error", async () => {
  await expect(decrypt("invalid_base64!@#")).rejects.toThrow("Decryption failed")

  await expect(decrypt("dG9vc2hvcnQ=")).rejects.toThrow("Invalid ciphertext: too short")

  await expect(decrypt(btoa("a".repeat(12) + "corrupted"))).rejects.toThrow(
    "Decryption failed",
  )
})

Deno.test("crypto: empty string handled correctly", async () => {
  const plaintext = ""
  const encrypted = await encrypt(plaintext)
  const decrypted = await decrypt(encrypted)
  expect(decrypted).toBe(plaintext)
})

Deno.test("crypto: long strings handled correctly", async () => {
  const plaintext = "a".repeat(10000)
  const encrypted = await encrypt(plaintext)
  const decrypted = await decrypt(encrypted)
  expect(decrypted).toBe(plaintext)
})

Deno.test("crypto: special characters handled correctly", async () => {
  const plaintext = "🔐 token with émojis & spëcial çhars: !@#$%^&*()"
  const encrypted = await encrypt(plaintext)
  const decrypted = await decrypt(encrypted)
  expect(decrypted).toBe(plaintext)
})
