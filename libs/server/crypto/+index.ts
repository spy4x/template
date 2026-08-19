/**
 * AES-256-GCM encryption for secrets held at rest (OAuth tokens, API keys).
 *
 * The IV is generated per call and prepended to the ciphertext, so encrypting
 * the same plaintext twice yields different output. Output is base64.
 *
 * The secret is injected rather than read from config so this module stays
 * free of app dependencies and is testable without environment setup.
 *
 * NOTE: the key is derived from the secret with a single SHA-256 pass. If the
 * caller passes a secret that is also used for another purpose (for example a
 * password pepper), that reuse — not this module — is the weak point. Prefer a
 * dedicated secret, and see the follow-up note in HANDOFF.md about moving to
 * HKDF with a distinct info label.
 */

const ALGORITHM = "AES-GCM"
const KEY_LENGTH = 256
const IV_LENGTH = 12 // 96 bits, recommended for GCM

export class CryptoError extends Error {
  constructor(message: string, cause?: unknown) {
    super(message)
    this.name = "CryptoError"
    this.cause = cause
  }
}

export class CryptoService {
  #key: Promise<CryptoKey> | null = null

  constructor(private readonly secret: string) {
    if (!secret) {
      throw new CryptoError("CryptoService requires a non-empty secret")
    }
  }

  #getKey(): Promise<CryptoKey> {
    if (!this.#key) {
      this.#key = (async () => {
        try {
          const keyData = await crypto.subtle.digest(
            "SHA-256",
            new TextEncoder().encode(this.secret),
          )
          return await crypto.subtle.importKey(
            "raw",
            keyData,
            { name: ALGORITHM, length: KEY_LENGTH },
            false,
            ["encrypt", "decrypt"],
          )
        } catch (error) {
          this.#key = null
          throw new CryptoError("Failed to derive encryption key", error)
        }
      })()
    }
    return this.#key
  }

  /** Returns base64 of [IV (12 bytes)][ciphertext]. */
  async encrypt(plaintext: string): Promise<string> {
    try {
      const key = await this.#getKey()
      const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH))
      const ciphertext = await crypto.subtle.encrypt(
        { name: ALGORITHM, iv },
        key,
        new TextEncoder().encode(plaintext),
      )

      const result = new Uint8Array(iv.length + ciphertext.byteLength)
      result.set(iv, 0)
      result.set(new Uint8Array(ciphertext), iv.length)
      return encodeBase64(result)
    } catch (error) {
      if (error instanceof CryptoError) throw error
      throw new CryptoError("Encryption failed", error)
    }
  }

  /** Accepts base64 of [IV (12 bytes)][ciphertext]. */
  async decrypt(ciphertext: string): Promise<string> {
    try {
      const key = await this.#getKey()
      const encrypted = decodeBase64(ciphertext)

      if (encrypted.length < IV_LENGTH) {
        throw new CryptoError("Invalid ciphertext: too short")
      }

      const decrypted = await crypto.subtle.decrypt(
        { name: ALGORITHM, iv: encrypted.slice(0, IV_LENGTH) },
        key,
        encrypted.slice(IV_LENGTH),
      )
      return new TextDecoder().decode(decrypted)
    } catch (error) {
      if (error instanceof CryptoError) throw error
      throw new CryptoError("Decryption failed", error)
    }
  }
}

function encodeBase64(bytes: Uint8Array): string {
  let binary = ""
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i])
  }
  return btoa(binary)
}

function decodeBase64(value: string): Uint8Array {
  return Uint8Array.from(atob(value), (character) => character.charCodeAt(0))
}
