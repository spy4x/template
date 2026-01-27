import { config } from "./config.ts"

/**
 * Crypto service for encrypting/decrypting sensitive data using AES-256-GCM.
 * Uses AUTH_PEPPER as key base. IV is prepended to ciphertext.
 */

const ALGORITHM = "AES-GCM"
const KEY_LENGTH = 256
const IV_LENGTH = 12 // 96 bits recommended for GCM

class CryptoError extends Error {
  constructor(message: string, cause?: unknown) {
    super(message)
    this.name = "CryptoError"
    this.cause = cause
  }
}

let cachedKey: CryptoKey | null = null

/**
 * Derives encryption key from AUTH_PEPPER using SHA-256
 */
async function getKey(): Promise<CryptoKey> {
  if (cachedKey) return cachedKey

  try {
    const encoder = new TextEncoder()
    const keyMaterial = encoder.encode(config.authPepper)

    // Hash pepper to get 256-bit key
    const keyData = await crypto.subtle.digest("SHA-256", keyMaterial)

    cachedKey = await crypto.subtle.importKey(
      "raw",
      keyData,
      { name: ALGORITHM, length: KEY_LENGTH },
      false,
      ["encrypt", "decrypt"],
    )

    return cachedKey
  } catch (error) {
    throw new CryptoError("Failed to derive encryption key", error)
  }
}

/**
 * Encrypts plaintext using AES-256-GCM.
 * Returns base64-encoded string with IV prepended.
 *
 * @param plaintext - String to encrypt
 * @returns Base64 string: [IV (12 bytes)][ciphertext]
 */
export async function encrypt(plaintext: string): Promise<string> {
  try {
    const key = await getKey()
    const encoder = new TextEncoder()
    const data = encoder.encode(plaintext)

    // Generate random IV
    const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH))

    // Encrypt
    const ciphertext = await crypto.subtle.encrypt(
      { name: ALGORITHM, iv },
      key,
      data,
    )

    // Prepend IV to ciphertext
    const result = new Uint8Array(iv.length + ciphertext.byteLength)
    result.set(iv, 0)
    result.set(new Uint8Array(ciphertext), iv.length)

    // Encode as base64 (proper binary encoding)
    let binary = ""
    for (let i = 0; i < result.length; i++) {
      binary += String.fromCharCode(result[i])
    }
    return btoa(binary)
  } catch (error) {
    throw new CryptoError("Encryption failed", error)
  }
}

/**
 * Decrypts base64-encoded ciphertext using AES-256-GCM.
 * Expects IV prepended to ciphertext.
 *
 * @param ciphertext - Base64 string: [IV (12 bytes)][ciphertext]
 * @returns Decrypted plaintext
 */
export async function decrypt(ciphertext: string): Promise<string> {
  try {
    const key = await getKey()

    // Decode base64
    const encrypted = Uint8Array.from(atob(ciphertext), (c) => c.charCodeAt(0))

    if (encrypted.length < IV_LENGTH) {
      throw new CryptoError("Invalid ciphertext: too short")
    }

    // Extract IV and ciphertext
    const iv = encrypted.slice(0, IV_LENGTH)
    const data = encrypted.slice(IV_LENGTH)

    // Decrypt
    const decrypted = await crypto.subtle.decrypt(
      { name: ALGORITHM, iv },
      key,
      data,
    )

    const decoder = new TextDecoder()
    return decoder.decode(decrypted)
  } catch (error) {
    if (error instanceof CryptoError) throw error
    throw new CryptoError("Decryption failed", error)
  }
}
