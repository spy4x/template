import { runCommand } from "@platform/process"
import {
  assertDotenvBounds,
  EnvWorkflowError,
  loadEnvManifest,
  loadSopsConfig,
  MAX_CIPHERTEXT_BYTES,
  MAX_ENV_FILE_BYTES,
  readVerifiedTextFile,
} from "./config.ts"
import { assertSopsDotenvCiphertext } from "./ciphertext.ts"

const MAX_GIT_PATH_OUTPUT_BYTES = 8 * 1024 * 1024
const CREDENTIAL_KEY =
  /(?:_PASS|_PASSWORD|_SECRET|_TOKEN|_API_KEY|_ACCESS_KEY_ID|_USER|_PEPPER|_TOTP|SLACK_SYSTEM_URL)$/

export interface EnvCheckOptions {
  repoRoot?: string
  manifestPath?: string
  sopsConfigPath?: string
  report?: (message: string) => void
}

function isPlaintextEnvPath(path: string): boolean {
  const name = path.split("/").at(-1) ?? ""
  return (name === ".env" || name.endsWith(".env") || name.includes(".env.")) &&
    !name.endsWith(".example") && !name.endsWith(".age")
}

function isCiphertextEnvPath(path: string): boolean {
  const name = path.split("/").at(-1) ?? ""
  return name.endsWith(".age") &&
    (name === ".env.age" || name.includes(".env.") || name.endsWith(".env.age"))
}

async function gitPathIsIgnored(repoRoot: string, path: string): Promise<boolean> {
  const result = await runCommand(
    ["git", "check-ignore", "--no-index", "--quiet", "--", path],
    { cwd: repoRoot, stdout: "null", stderr: "null" },
  )
  if (result.code !== 0 && result.code !== 1) {
    throw new EnvWorkflowError(`Git ignore policy check failed for ${path}`)
  }
  return result.code === 0
}

async function assertGitIgnorePolicy(
  repoRoot: string,
  plaintext: string,
  ciphertext: string,
  example: string,
): Promise<void> {
  if (!await gitPathIsIgnored(repoRoot, plaintext)) {
    throw new EnvWorkflowError(`Manifest plaintext must be ignored by Git: ${plaintext}`)
  }
  if (await gitPathIsIgnored(repoRoot, ciphertext)) {
    throw new EnvWorkflowError(`Manifest ciphertext must be trackable by Git: ${ciphertext}`)
  }
  if (await gitPathIsIgnored(repoRoot, example)) {
    throw new EnvWorkflowError(`Manifest example must be trackable by Git: ${example}`)
  }
}

async function assertTrackedEnvironmentPolicy(
  repoRoot: string,
  manifestCiphertexts: ReadonlySet<string>,
): Promise<void> {
  const result = await runCommand(["git", "ls-files", "-z"], {
    cwd: repoRoot,
    maxOutputBytes: MAX_GIT_PATH_OUTPUT_BYTES,
  })
  if (!result.success) {
    throw new EnvWorkflowError("Could not inspect tracked files")
  }
  const trackedPaths = result.stdout.split("\0").filter((path) => path.length > 0)
  const trackedPlaintext = trackedPaths.filter(isPlaintextEnvPath)
  if (trackedPlaintext.length > 0) {
    throw new EnvWorkflowError(`Tracked plaintext environment file: ${trackedPlaintext[0]}`)
  }
  const unlistedCiphertext = trackedPaths.find((path) =>
    isCiphertextEnvPath(path) && !manifestCiphertexts.has(path)
  )
  if (unlistedCiphertext !== undefined) {
    throw new EnvWorkflowError(
      `Tracked environment ciphertext is not in manifest: ${unlistedCiphertext}`,
    )
  }
}

async function assertExample(
  path: string,
  requiredKeys: readonly string[],
): Promise<Record<string, string>> {
  const { content } = await readVerifiedTextFile(path, "Manifest example", MAX_ENV_FILE_BYTES)
  const values = assertDotenvBounds(content, "Manifest example")
  for (const key of requiredKeys) {
    if (!(key in values)) {
      throw new EnvWorkflowError(`Manifest example is missing required key: ${key}`)
    }
  }
  for (const [key, value] of Object.entries(values)) {
    if (CREDENTIAL_KEY.test(key) && !value.startsWith("REPLACE_WITH_")) {
      throw new EnvWorkflowError(`Manifest example credential ${key} must use REPLACE_WITH_*`)
    }
  }
  return values
}

async function readOptionalCiphertext(path: string): Promise<string | null> {
  try {
    return (await readVerifiedTextFile(path, "Manifest ciphertext", MAX_CIPHERTEXT_BYTES)).content
  } catch (cause) {
    if (cause instanceof EnvWorkflowError && cause.message === "Manifest ciphertext is missing") {
      return null
    }
    throw cause
  }
}

export async function checkEnvironments(options: EnvCheckOptions = {}): Promise<void> {
  const report = options.report ?? console.log
  const manifest = await loadEnvManifest(options.repoRoot ?? Deno.cwd(), options.manifestPath)
  const sopsConfig = await loadSopsConfig(manifest, options.sopsConfigPath, true)
  await assertTrackedEnvironmentPolicy(
    manifest.repoRoot,
    new Set(manifest.files.map((entry) => entry.ciphertext)),
  )
  if (!await gitPathIsIgnored(manifest.repoRoot, ".age/env-check-probe")) {
    throw new EnvWorkflowError(".age/ must be ignored by Git")
  }

  const missingCiphertexts: string[] = []
  for (const [index, entry] of manifest.files.entries()) {
    await assertGitIgnorePolicy(
      manifest.repoRoot,
      entry.plaintext,
      entry.ciphertext,
      entry.example,
    )
    const requiredKeys = Object.keys(entry.requiredValues)
    const exampleValues = await assertExample(entry.examplePath, requiredKeys)
    const ciphertext = await readOptionalCiphertext(entry.ciphertextPath)
    if (ciphertext === null) {
      missingCiphertexts.push(entry.ciphertext)
    } else {
      assertSopsDotenvCiphertext(
        ciphertext,
        Object.keys(exampleValues),
        sopsConfig.rules[index].ageRecipient,
        `Manifest ciphertext ${entry.ciphertext}`,
      )
    }
  }

  if (sopsConfig.usesPlaceholder && missingCiphertexts.length !== manifest.files.length) {
    throw new EnvWorkflowError(
      "SOPS recipient placeholder cannot be used with initialized ciphertext",
    )
  }
  if (sopsConfig.usesPlaceholder || missingCiphertexts.length > 0) {
    const missing = missingCiphertexts.length > 0
      ? ` Missing ciphertext: ${missingCiphertexts.join(", ")}.`
      : ""
    report(
      `Environment encryption not initialized: replace REPLACE_WITH_AGE_RECIPIENT in .sops.yaml, create mode-0600 plaintext, then run deno task env:encrypt.${missing}`,
    )
  } else {
    report("Environment encryption policy valid.")
  }
}
