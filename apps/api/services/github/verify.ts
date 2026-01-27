import { config } from "@api/services/config.ts"

function toHex(buffer: ArrayBuffer): string {
  return [...new Uint8Array(buffer)].map((b) => b.toString(16).padStart(2, "0")).join("")
}

export async function verifyWebhookSignature(
  signature: string | undefined,
  body: string,
): Promise<boolean> {
  const secret = config.github.webhookSecret
  if (!secret) return !config.github.webhookEnforce
  if (!signature) return false
  const enc = new TextEncoder()
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  )
  const mac = await crypto.subtle.sign("HMAC", key, enc.encode(body))
  const digest = `sha256=${toHex(mac)}`
  return timingSafeEqual(enc.encode(digest), enc.encode(signature))
}

function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i += 1) {
    diff |= a[i] ^ b[i]
  }
  return diff === 0
}
