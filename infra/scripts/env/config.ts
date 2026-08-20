import { parse as parseDotenv } from "@std/dotenv"
import { dirname, isAbsolute, normalize, relative, resolve } from "@std/path"
import { parse as parseYaml } from "@std/yaml"

export const DEFAULT_MANIFEST_PATH = "infra/envs/encrypted-files.json"
export const DEFAULT_SOPS_CONFIG_PATH = ".sops.yaml"
export const AGE_RECIPIENT_PLACEHOLDER = "REPLACE_WITH_AGE_RECIPIENT"
export const MAX_MANIFEST_BYTES = 64 * 1024
export const MAX_ENV_FILE_BYTES = 1024 * 1024
export const MAX_CIPHERTEXT_BYTES = 4 * 1024 * 1024
const MAX_ENTRIES = 64
const MAX_PATH_BYTES = 512
const MAX_VARIABLES = 512
const MAX_KEY_BYTES = 128
const MAX_VALUE_BYTES = 64 * 1024

export interface EnvFileManifestEntry {
  plaintext: string
  ciphertext: string
  example: string
  requiredValues: Readonly<Record<string, string>>
}

export interface ResolvedEnvFileEntry extends EnvFileManifestEntry {
  plaintextPath: string
  ciphertextPath: string
  examplePath: string
}

export interface LoadedEnvManifest {
  version: 1
  repoRoot: string
  manifestPath: string
  files: ResolvedEnvFileEntry[]
}

export interface SopsCreationRule {
  pathRegex: string
  ageRecipient: string
}

export interface LoadedSopsConfig {
  configPath: string
  rules: SopsCreationRule[]
  usesPlaceholder: boolean
}

export interface VerifiedRegularFile {
  bytes: Uint8Array
  info: Deno.FileInfo
}

export class EnvWorkflowError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "EnvWorkflowError"
  }
}

function byteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength
}

function assertExactKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
  label: string,
): void {
  const actual = Object.keys(value).sort()
  const wanted = [...expected].sort()
  if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) {
    throw new EnvWorkflowError(`${label} has unsupported or missing fields`)
  }
}

function assertRelativeManifestPath(path: unknown, label: string): asserts path is string {
  if (
    typeof path !== "string" || path.length === 0 || byteLength(path) > MAX_PATH_BYTES ||
    path.includes("\\") || path.includes("\0") || isAbsolute(path) || normalize(path) !== path ||
    path.split("/").some((part) => part === "" || part === "." || part === "..")
  ) {
    throw new EnvWorkflowError(`${label} must be a normalized relative repository path`)
  }
}

function isInsideRoot(repoRoot: string, path: string): boolean {
  const fromRoot = relative(repoRoot, path)
  return fromRoot === "" ||
    (!isAbsolute(fromRoot) && fromRoot !== ".." && !fromRoot.startsWith("../"))
}

export async function assertParentInsideRoot(repoRoot: string, path: string): Promise<void> {
  let realParent: string
  try {
    realParent = await Deno.realPath(dirname(path))
  } catch (cause) {
    if (cause instanceof Deno.errors.NotFound) {
      throw new EnvWorkflowError(`Manifest path parent does not exist inside repository`)
    }
    throw cause
  }
  if (!isInsideRoot(repoRoot, realParent)) {
    throw new EnvWorkflowError(`Manifest path parent resolves outside repository`)
  }
}

export async function getRegularFileInfo(
  path: string,
  label: string,
  maxBytes: number,
): Promise<Deno.FileInfo> {
  let info: Deno.FileInfo
  try {
    info = await Deno.lstat(path)
  } catch (cause) {
    if (cause instanceof Deno.errors.NotFound) {
      throw new EnvWorkflowError(`${label} is missing`)
    }
    throw cause
  }
  if (!info.isFile || info.isSymlink) {
    throw new EnvWorkflowError(`${label} must be a regular file, not a symlink`)
  }
  if (info.size > maxBytes) {
    throw new EnvWorkflowError(`${label} exceeds ${maxBytes} bytes`)
  }
  return info
}

export async function getOptionalRegularFileInfo(
  path: string,
  label: string,
  maxBytes: number,
): Promise<Deno.FileInfo | null> {
  try {
    return await getRegularFileInfo(path, label, maxBytes)
  } catch (cause) {
    if (cause instanceof EnvWorkflowError && cause.message === `${label} is missing`) {
      return null
    }
    throw cause
  }
}

function hasSameIdentity(left: Deno.FileInfo, right: Deno.FileInfo): boolean {
  return left.dev !== null && right.dev !== null && left.ino !== null && right.ino !== null &&
    left.dev === right.dev && left.ino === right.ino
}

function hasSameSnapshot(left: Deno.FileInfo, right: Deno.FileInfo): boolean {
  return hasSameIdentity(left, right) && left.size === right.size &&
    left.mtime?.getTime() === right.mtime?.getTime()
}

export async function readVerifiedRegularFile(
  path: string,
  label: string,
  maxBytes: number,
): Promise<VerifiedRegularFile> {
  const initialInfo = await getRegularFileInfo(path, label, maxBytes)
  const file = await Deno.open(path, { read: true })
  try {
    const openedInfo = await file.stat()
    if (!openedInfo.isFile || !hasSameSnapshot(initialInfo, openedInfo)) {
      throw new EnvWorkflowError(`${label} changed while opening`)
    }

    const chunks: Uint8Array[] = []
    let length = 0
    const buffer = new Uint8Array(64 * 1024)
    while (true) {
      const read = await file.read(buffer)
      if (read === null) break
      length += read
      if (length > maxBytes) {
        throw new EnvWorkflowError(`${label} exceeds ${maxBytes} bytes`)
      }
      chunks.push(buffer.slice(0, read))
    }

    const finalInfo = await file.stat()
    if (!hasSameSnapshot(openedInfo, finalInfo) || length !== finalInfo.size) {
      throw new EnvWorkflowError(`${label} changed while reading`)
    }

    const bytes = new Uint8Array(length)
    let offset = 0
    for (const chunk of chunks) {
      bytes.set(chunk, offset)
      offset += chunk.byteLength
    }
    return { bytes, info: finalInfo }
  } finally {
    file.close()
  }
}

export async function readVerifiedTextFile(
  path: string,
  label: string,
  maxBytes: number,
): Promise<{ bytes: Uint8Array; content: string; info: Deno.FileInfo }> {
  const verified = await readVerifiedRegularFile(path, label, maxBytes)
  try {
    return {
      bytes: verified.bytes,
      content: new TextDecoder("utf-8", { fatal: true }).decode(verified.bytes),
      info: verified.info,
    }
  } catch {
    throw new EnvWorkflowError(`${label} is not valid UTF-8`)
  }
}

export function assertDotenvBounds(content: string, label: string): Record<string, string> {
  let values: Record<string, string>
  try {
    values = parseDotenv(content)
  } catch {
    throw new EnvWorkflowError(`${label} is not valid dotenv content`)
  }
  const entries = Object.entries(values)
  if (entries.length > MAX_VARIABLES) {
    throw new EnvWorkflowError(`${label} exceeds ${MAX_VARIABLES} variables`)
  }
  for (const [key, value] of entries) {
    if (byteLength(key) > MAX_KEY_BYTES || byteLength(value) > MAX_VALUE_BYTES) {
      throw new EnvWorkflowError(`${label} contains an oversized key or value`)
    }
  }
  return values
}

export function assertRequiredValues(
  values: Readonly<Record<string, string>>,
  requiredValues: Readonly<Record<string, string>>,
  label: string,
): void {
  for (const [key, expected] of Object.entries(requiredValues)) {
    if (values[key] !== expected) {
      throw new EnvWorkflowError(`${label} must set ${key}=${expected}`)
    }
  }
}

export function assertExactEnvKeys(
  values: Readonly<Record<string, string>>,
  expectedValues: Readonly<Record<string, string>>,
  label: string,
): void {
  const actualKeys = Object.keys(values)
  const expectedKeys = new Set(Object.keys(expectedValues))
  const missingKey = [...expectedKeys].find((key) => !(key in values))
  const extraKey = actualKeys.find((key) => !expectedKeys.has(key))
  if (
    actualKeys.length !== expectedKeys.size || missingKey !== undefined || extraKey !== undefined
  ) {
    const detail = missingKey !== undefined ? `missing ${missingKey}` : `unexpected ${extraKey}`
    throw new EnvWorkflowError(`${label} keys do not match manifest example: ${detail}`)
  }
}

export function assertPlaintextValuesReady(
  values: Readonly<Record<string, string>>,
  exampleValues: Readonly<Record<string, string>>,
  label: string,
): void {
  for (const [key, value] of Object.entries(values)) {
    if (value.startsWith("REPLACE_WITH_")) {
      throw new EnvWorkflowError(`${label} contains unresolved placeholder: ${key}`)
    }
    if (exampleValues[key]?.startsWith("REPLACE_WITH_") && value.length === 0) {
      throw new EnvWorkflowError(`${label} credential value must not be empty: ${key}`)
    }
  }
}

export async function loadEnvManifest(
  repoRoot: string,
  manifestRelativePath = DEFAULT_MANIFEST_PATH,
): Promise<LoadedEnvManifest> {
  const realRoot = await Deno.realPath(repoRoot)
  assertRelativeManifestPath(manifestRelativePath, "Manifest file path")
  const manifestPath = resolve(realRoot, manifestRelativePath)
  await assertParentInsideRoot(realRoot, manifestPath)
  const { content } = await readVerifiedTextFile(
    manifestPath,
    "Environment manifest",
    MAX_MANIFEST_BYTES,
  )

  let parsed: unknown
  try {
    parsed = JSON.parse(content)
  } catch {
    throw new EnvWorkflowError("Environment manifest is not valid JSON")
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new EnvWorkflowError("Environment manifest must be an object")
  }
  assertExactKeys(parsed as Record<string, unknown>, ["version", "files"], "Environment manifest")
  const manifest = parsed as { version: unknown; files: unknown }
  if (manifest.version !== 1) {
    throw new EnvWorkflowError("Environment manifest version must be 1")
  }
  if (
    !Array.isArray(manifest.files) || manifest.files.length === 0 ||
    manifest.files.length > MAX_ENTRIES
  ) {
    throw new EnvWorkflowError(`Environment manifest must contain 1-${MAX_ENTRIES} files`)
  }

  const seenPaths = new Set<string>()
  const files = await Promise.all(manifest.files.map(async (rawEntry, index) => {
    const label = `Environment manifest entry ${index + 1}`
    if (typeof rawEntry !== "object" || rawEntry === null || Array.isArray(rawEntry)) {
      throw new EnvWorkflowError(`${label} must be an object`)
    }
    const entry = rawEntry as Record<string, unknown>
    assertExactKeys(entry, ["plaintext", "ciphertext", "example", "requiredValues"], label)
    assertRelativeManifestPath(entry.plaintext, `${label} plaintext`)
    assertRelativeManifestPath(entry.ciphertext, `${label} ciphertext`)
    assertRelativeManifestPath(entry.example, `${label} example`)
    if (entry.plaintext.endsWith(".age") || entry.plaintext.endsWith(".example")) {
      throw new EnvWorkflowError(`${label} plaintext has an invalid file role suffix`)
    }
    if (entry.ciphertext !== `${entry.plaintext}.age`) {
      throw new EnvWorkflowError(`${label} ciphertext must be plaintext path plus .age`)
    }
    if (!entry.example.endsWith(".example")) {
      throw new EnvWorkflowError(`${label} example path must end with .example`)
    }
    if (
      typeof entry.requiredValues !== "object" || entry.requiredValues === null ||
      Array.isArray(entry.requiredValues)
    ) {
      throw new EnvWorkflowError(`${label} requiredValues must be an object`)
    }
    const requiredValues = entry.requiredValues as Record<string, unknown>
    if (Object.keys(requiredValues).length === 0 || Object.keys(requiredValues).length > 32) {
      throw new EnvWorkflowError(`${label} requiredValues must contain 1-32 entries`)
    }
    for (const [key, value] of Object.entries(requiredValues)) {
      if (
        !/^[A-Za-z_][A-Za-z0-9_]*$/.test(key) || byteLength(key) > MAX_KEY_BYTES ||
        typeof value !== "string" || value.length === 0 || byteLength(value) > MAX_VALUE_BYTES
      ) {
        throw new EnvWorkflowError(`${label} contains an invalid required value`)
      }
    }
    if (entry.plaintext.endsWith(".env.prod") && requiredValues.ENV !== "prod") {
      throw new EnvWorkflowError(`${label} production plaintext must require ENV=prod`)
    }

    for (const path of [entry.plaintext, entry.ciphertext, entry.example]) {
      if (seenPaths.has(path)) {
        throw new EnvWorkflowError(`Environment manifest contains duplicate path: ${path}`)
      }
      seenPaths.add(path)
    }

    const resolvedEntry: ResolvedEnvFileEntry = {
      plaintext: entry.plaintext,
      ciphertext: entry.ciphertext,
      example: entry.example,
      requiredValues: requiredValues as Readonly<Record<string, string>>,
      plaintextPath: resolve(realRoot, entry.plaintext),
      ciphertextPath: resolve(realRoot, entry.ciphertext),
      examplePath: resolve(realRoot, entry.example),
    }
    await Promise.all([
      assertParentInsideRoot(realRoot, resolvedEntry.plaintextPath),
      assertParentInsideRoot(realRoot, resolvedEntry.ciphertextPath),
      assertParentInsideRoot(realRoot, resolvedEntry.examplePath),
    ])
    return resolvedEntry
  }))

  return { version: 1, repoRoot: realRoot, manifestPath, files }
}

function expectedPathRegex(path: string): string {
  return `^${path.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`
}

export async function loadSopsConfig(
  manifest: LoadedEnvManifest,
  configRelativePath = DEFAULT_SOPS_CONFIG_PATH,
  allowPlaceholder = false,
): Promise<LoadedSopsConfig> {
  assertRelativeManifestPath(configRelativePath, "SOPS config path")
  const configPath = resolve(manifest.repoRoot, configRelativePath)
  await assertParentInsideRoot(manifest.repoRoot, configPath)
  const { content } = await readVerifiedTextFile(
    configPath,
    "SOPS config",
    MAX_MANIFEST_BYTES,
  )
  let parsed: unknown
  try {
    parsed = parseYaml(content)
  } catch {
    throw new EnvWorkflowError("SOPS config is not valid YAML")
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new EnvWorkflowError("SOPS config must be an object")
  }
  const root = parsed as Record<string, unknown>
  assertExactKeys(root, ["creation_rules"], "SOPS config")
  if (!Array.isArray(root.creation_rules) || root.creation_rules.length !== manifest.files.length) {
    throw new EnvWorkflowError("SOPS config must define exactly one age rule per manifest entry")
  }
  const rules = root.creation_rules.map((rawRule, index): SopsCreationRule => {
    if (typeof rawRule !== "object" || rawRule === null || Array.isArray(rawRule)) {
      throw new EnvWorkflowError(`SOPS creation rule ${index + 1} must be an object`)
    }
    const rule = rawRule as Record<string, unknown>
    assertExactKeys(rule, ["path_regex", "age"], `SOPS creation rule ${index + 1}`)
    if (typeof rule.path_regex !== "string" || typeof rule.age !== "string") {
      throw new EnvWorkflowError(`SOPS creation rule ${index + 1} fields must be strings`)
    }
    return { pathRegex: rule.path_regex, ageRecipient: rule.age }
  })

  let usesPlaceholder = false
  for (const [index, rule] of rules.entries()) {
    const expected = expectedPathRegex(manifest.files[index].plaintext)
    if (rule.pathRegex !== expected) {
      throw new EnvWorkflowError(
        `SOPS rule ${index + 1} must match only its manifest plaintext path`,
      )
    }
    if (rule.ageRecipient === AGE_RECIPIENT_PLACEHOLDER) {
      usesPlaceholder = true
      if (!allowPlaceholder) {
        throw new EnvWorkflowError(
          `Replace ${AGE_RECIPIENT_PLACEHOLDER} in ${configRelativePath} before encryption`,
        )
      }
    } else if (!/^age1[0-9a-z]{58}$/.test(rule.ageRecipient)) {
      throw new EnvWorkflowError(`SOPS rule ${index + 1} has an invalid age recipient`)
    }
  }

  return { configPath, rules, usesPlaceholder }
}
