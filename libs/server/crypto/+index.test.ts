import { expect } from "@std/expect"
import { CryptoService } from "./+index.ts"

const crypto = new CryptoService("test-secret-for-encryption")

Deno.test("crypto: round-trip encrypt/decrypt returns original", async () => {
  const plaintext = "provider_token_example_123"
  expect(await crypto.decrypt(await crypto.encrypt(plaintext))).toBe(plaintext)
})

Deno.test("crypto: different encryptions produce different ciphertext", async () => {
  const plaintext = "same_token"
  const first = await crypto.encrypt(plaintext)
  const second = await crypto.encrypt(plaintext)

  // Different IV means different ciphertext
  expect(first).not.toBe(second)
  expect(await crypto.decrypt(first)).toBe(plaintext)
  expect(await crypto.decrypt(second)).toBe(plaintext)
})

Deno.test("crypto: invalid ciphertext throws", async () => {
  await expect(crypto.decrypt("invalid_base64!@#")).rejects.toThrow("Decryption failed")
  await expect(crypto.decrypt("dG9vc2hvcnQ=")).rejects.toThrow("Invalid ciphertext: too short")
  await expect(crypto.decrypt(btoa("a".repeat(12) + "corrupted"))).rejects.toThrow(
    "Decryption failed",
  )
})

Deno.test("crypto: a different secret cannot decrypt", async () => {
  const encrypted = await crypto.encrypt("secret payload")
  const other = new CryptoService("a-completely-different-secret")
  await expect(other.decrypt(encrypted)).rejects.toThrow("Decryption failed")
})

Deno.test("crypto: rejects an empty secret", () => {
  expect(() => new CryptoService("")).toThrow("non-empty secret")
})

Deno.test("crypto: empty, long and unicode payloads round-trip", async () => {
  for (const plaintext of ["", "a".repeat(10_000), "🔐 émojis & spëcial çhars: !@#$%^&*()"]) {
    expect(await crypto.decrypt(await crypto.encrypt(plaintext))).toBe(plaintext)
  }
})
