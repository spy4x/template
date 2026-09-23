// Duplicates root deno.jsonc's @std/encoding/@std/path pins: age.test.ts imports this file under
// `deno test --no-config`, which loads no import map, so the bare aliases can't resolve here.
// Bump this version whenever the root map's pin moves — nothing else keeps them in sync.
import { decodeBase64, encodeBase64 } from "jsr:@std/encoding@1.0.11"
import { dirname, join } from "jsr:@std/path@1.1.6"

const prefix = `age64:`

export interface AgeCrypto {
  encrypt(value: string): Promise<string>
  decrypt(value: string): Promise<string>
}

interface Assignment {
  key: string
  prefix: string
  value: string
}

interface OldValue {
  ciphertext?: string
  plaintext?: string
}

function assignment(line: string): Assignment | undefined {
  const match = line.match(/^(\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=)(.*)$/)
  if (!match) return undefined
  return { prefix: match[1], key: match[2], value: match[3] }
}

/** Index encrypted values by key occurrence so duplicate assignments remain stable. */
export async function indexCiphertext(
  content: string,
  decrypt: AgeCrypto["decrypt"],
): Promise<Map<string, OldValue[]>> {
  const values = new Map<string, OldValue[]>()
  for (const [index, line] of content.split(`\n`).entries()) {
    const entry = assignment(line)
    if (!entry) {
      assertNonAssignment(line, index)
      continue
    }
    const occurrences = values.get(entry.key) ?? []
    occurrences.push({
      ciphertext: entry.value.startsWith(prefix) ? entry.value : undefined,
      plaintext: entry.value.startsWith(prefix) ? await decrypt(entry.value) : undefined,
    })
    values.set(entry.key, occurrences)
  }
  return values
}

/** Encrypt assignments while preserving non-assignment lines and unchanged ciphertext. */
export async function renderEncrypted(
  content: string,
  oldValues: Map<string, OldValue[]>,
  encrypt: AgeCrypto["encrypt"],
): Promise<string> {
  const counts = new Map<string, number>()
  const output: string[] = []
  for (const [index, line] of content.split(`\n`).entries()) {
    const entry = assignment(line)
    if (!entry) {
      assertNonAssignment(line, index)
      output.push(line)
      continue
    }
    const occurrence = counts.get(entry.key) ?? 0
    counts.set(entry.key, occurrence + 1)
    const old = oldValues.get(entry.key)?.[occurrence]
    const value = old?.plaintext === entry.value && old.ciphertext
      ? old.ciphertext
      : await encrypt(entry.value)
    output.push(entry.prefix + value)
  }
  return output.join(`\n`)
}

/** Decrypt assignments and reject any plaintext value in committed encrypted input. */
export async function renderPlaintext(
  content: string,
  decrypt: AgeCrypto["decrypt"],
): Promise<string> {
  const output: string[] = []
  for (const [index, line] of content.split(`\n`).entries()) {
    const entry = assignment(line)
    if (!entry) {
      assertNonAssignment(line, index)
      output.push(line)
      continue
    }
    if (!entry.value.startsWith(prefix)) {
      throw new Error(`plaintext assignment at line ${index + 1}`)
    }
    output.push(entry.prefix + await decrypt(entry.value))
  }
  return output.join(`\n`)
}

function assertNonAssignment(line: string, index: number): void {
  const trimmed = line.trim()
  if (trimmed && !trimmed.startsWith(`#`)) {
    throw new Error(`unsupported env syntax at line ${index + 1}`)
  }
}

async function isCheckout(path: string): Promise<boolean> {
  try {
    const info = await Deno.lstat(join(path, `.git`))
    return info.isDirectory || info.isFile
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) return false
    throw error
  }
}

/** Recursively discover plaintext or encrypted env files without crossing repository boundaries. */
export async function findEnvFiles(root: string, encrypted: boolean): Promise<string[]> {
  const files: string[] = []
  async function walk(directory: string): Promise<void> {
    for await (const entry of Deno.readDir(directory)) {
      const path = join(directory, entry.name)
      if (entry.isDirectory) {
        if (entry.name.startsWith(`.`) || entry.name === `node_modules`) continue
        if (!(await isCheckout(path))) await walk(path)
        continue
      }
      const isEncrypted = entry.name.startsWith(`.env`) && entry.name.endsWith(`.age`)
      const isExample = entry.name.includes(`.example`)
      if (entry.name.startsWith(`.env`) && !isExample && isEncrypted === encrypted) {
        if (entry.isSymlink) throw new Error(`refusing env symlink: ${path}`)
        if (entry.isFile) files.push(path)
      }
    }
  }
  await walk(root)
  return files.sort()
}

async function assertRegularOrMissing(path: string): Promise<void> {
  try {
    const info = await Deno.lstat(path)
    if (!info.isFile) throw new Error(`refusing non-regular output: ${path}`)
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) return
    throw error
  }
}

/** Write through a same-directory temporary file, then atomically replace the destination. */
async function atomicWrite(path: string, content: string, mode: number): Promise<void> {
  await assertRegularOrMissing(path)
  const temporaryPath = await Deno.makeTempFile({ dir: dirname(path), prefix: `.env.tmp-` })
  try {
    await Deno.writeTextFile(temporaryPath, content)
    await Deno.chmod(temporaryPath, mode)
    await Deno.rename(temporaryPath, path)
  } finally {
    try {
      await Deno.remove(temporaryPath)
    } catch { /* Already renamed or best-effort cleanup after failure. */ }
  }
}

/** Fail explicitly when age CLI cannot execute. */
async function assertAgeInstalled(): Promise<void> {
  try {
    const result = await new Deno.Command(`age`, {
      args: [`--version`],
      stdout: `null`,
      stderr: `null`,
    }).output()
    if (!result.success) throw new Error(`age executable failed its version check`)
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) throw new Error(`age executable not found`)
    throw error
  }
}

/** Read private-key path and public recipient from `<root>/.age/key.txt`. */
async function readKey(root: string): Promise<{ path: string; recipient: string }> {
  const path = join(root, `.age`, `key.txt`)
  let content: string
  try {
    content = await Deno.readTextFile(path)
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) throw new Error(`age key not found: ${path}`)
    throw error
  }
  const recipient = content.match(/^# public key: (\S+)$/m)?.[1]
  if (!recipient) throw new Error(`age public key not found: ${path}`)
  return { path, recipient }
}

/** Build direct age CLI encryption functions for one repository root. */
async function createCrypto(root: string): Promise<AgeCrypto> {
  await assertAgeInstalled()
  const key = await readKey(root)
  /** Run age with piped bytes and surface a concise command error. */
  async function run(args: string[], input: Uint8Array): Promise<Uint8Array> {
    const process = new Deno.Command(`age`, {
      args,
      stdin: `piped`,
      stdout: `piped`,
      stderr: `piped`,
    }).spawn()
    const output = process.output()
    const writer = process.stdin.getWriter()
    await writer.write(input)
    await writer.close()
    const result = await output
    if (!result.success) {
      const detail = new TextDecoder().decode(result.stderr).trim()
      throw new Error(`age failed${detail ? `: ${detail}` : ``}`)
    }
    return result.stdout
  }
  return {
    async encrypt(value) {
      const encrypted = await run([`-r`, key.recipient, `-o`, `-`], new TextEncoder().encode(value))
      return prefix + encodeBase64(encrypted)
    },
    async decrypt(value) {
      if (!value.startsWith(prefix)) throw new Error(`invalid age64 value`)
      const encrypted = decodeBase64(value.slice(prefix.length))
      return new TextDecoder().decode(await run([`-d`, `-i`, key.path, `-o`, `-`], encrypted))
    },
  }
}

/** Encrypt every discovered plaintext env file to its adjacent `.age` file. */
export async function encryptEnvFiles(root: string): Promise<number> {
  const crypto = await createCrypto(root)
  const files = await findEnvFiles(root, false)
  for (const path of files) {
    const encryptedPath = `${path}.age`
    let previous = ``
    try {
      previous = await Deno.readTextFile(encryptedPath)
    } catch (error) {
      if (!(error instanceof Deno.errors.NotFound)) throw error
    }
    const oldValues = await indexCiphertext(previous, crypto.decrypt)
    const content = await Deno.readTextFile(path)
    await atomicWrite(
      encryptedPath,
      await renderEncrypted(content, oldValues, crypto.encrypt),
      0o644,
    )
  }
  return files.length
}

/** Decrypt every discovered `.env*.age` file and protect output with mode 0600. */
export async function decryptEnvFiles(root: string): Promise<number> {
  const crypto = await createCrypto(root)
  const files = await findEnvFiles(root, true)
  for (const path of files) {
    const plaintextPath = path.slice(0, -`.age`.length)
    const content = await Deno.readTextFile(path)
    await atomicWrite(plaintextPath, await renderPlaintext(content, crypto.decrypt), 0o600)
  }
  return files.length
}
