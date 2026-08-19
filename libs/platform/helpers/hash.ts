const iterations = 100_000
const keyLength = 32

export async function hash(password: string, pepper: string): Promise<string> {
  const encoder = new TextEncoder()
  const salt = crypto.getRandomValues(new Uint8Array(16))
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(password + pepper),
    "PBKDF2",
    false,
    ["deriveBits"],
  )
  const derivedBits = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      salt,
      iterations,
      hash: "SHA-256",
    },
    key,
    keyLength * 8,
  )
  const derivedKey = new Uint8Array(derivedBits)
  const saltHex = Array.from(salt).map((b) => b.toString(16).padStart(2, "0")).join("")
  const derivedKeyHex = Array.from(derivedKey).map((b) => b.toString(16).padStart(2, "0")).join("")
  return `${saltHex}:${derivedKeyHex}`
}

export async function checkHash(
  originalString: string,
  hashedString: string,
  pepper: string,
): Promise<boolean> {
  const [saltHex, storedHashHex] = hashedString.split(":")
  const salt = new Uint8Array(saltHex.match(/.{1,2}/g)!.map((byte) => parseInt(byte, 16)))
  const encoder = new TextEncoder()
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(originalString + pepper),
    "PBKDF2",
    false,
    ["deriveBits"],
  )
  const derivedBits = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      salt,
      iterations,
      hash: "SHA-256",
    },
    key,
    keyLength * 8,
  )
  const derivedKey = new Uint8Array(derivedBits)
  const derivedKeyHex = Array.from(derivedKey).map((b) => b.toString(16).padStart(2, "0")).join("")
  return derivedKeyHex === storedHashHex
}
