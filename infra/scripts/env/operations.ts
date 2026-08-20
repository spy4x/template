import { dirname } from "@std/path"
import { runCommand } from "@platform/process"
import {
  assertDotenvBounds,
  assertExactEnvKeys,
  assertParentInsideRoot,
  assertPlaintextValuesReady,
  assertRequiredValues,
  EnvWorkflowError,
  getOptionalRegularFileInfo,
  loadEnvManifest,
  loadSopsConfig,
  MAX_CIPHERTEXT_BYTES,
  MAX_ENV_FILE_BYTES,
  readVerifiedTextFile,
} from "./config.ts"
import { assertSopsDotenvCiphertext } from "./ciphertext.ts"

export interface EnvOperationOptions {
  repoRoot?: string
  manifestPath?: string
  sopsConfigPath?: string
  processEnv?: Readonly<Record<string, string>>
}

async function assertReplaceableDestination(
  repoRoot: string,
  path: string,
  label: string,
  maxBytes: number,
  requirePrivateMode: boolean,
): Promise<void> {
  await assertParentInsideRoot(repoRoot, path)
  const info = await getOptionalRegularFileInfo(path, label, maxBytes)
  if (requirePrivateMode && info !== null && info.mode !== null && (info.mode & 0o077) !== 0) {
    throw new EnvWorkflowError(`${label} has unsafe permissions; expected mode 0600`)
  }
}

const MAX_SOPS_STDERR_BYTES = 512

function truncatedSopsStderr(stderr: string): string {
  return stderr.length <= MAX_SOPS_STDERR_BYTES
    ? stderr
    : `${stderr.slice(0, MAX_SOPS_STDERR_BYTES)}...`
}

async function writeAll(file: Deno.FsFile, data: Uint8Array): Promise<void> {
  let offset = 0
  while (offset < data.byteLength) {
    offset += await file.write(data.subarray(offset))
  }
}

async function atomicWrite(
  repoRoot: string,
  destination: string,
  label: string,
  content: string,
  mode: number,
  maxBytes: number,
  requirePrivateDestination: boolean,
): Promise<void> {
  const bytes = new TextEncoder().encode(content)
  if (bytes.byteLength > maxBytes) {
    throw new EnvWorkflowError(`${label} exceeds ${maxBytes} bytes`)
  }
  await assertReplaceableDestination(
    repoRoot,
    destination,
    label,
    maxBytes,
    requirePrivateDestination,
  )

  // Deno.makeTempFile uses mkstemp(3) which creates files mode 0600 by default;
  // chmod below keeps the explicit mode in one place for callers that need 0644.
  const temporaryPath = await Deno.makeTempFile({
    dir: dirname(destination),
    prefix: ".sops-write-",
    suffix: ".tmp",
  })
  try {
    const file = await Deno.open(temporaryPath, { write: true, truncate: true })
    try {
      await writeAll(file, bytes)
      await file.sync()
    } finally {
      file.close()
    }
    await Deno.chmod(temporaryPath, mode)
    await assertReplaceableDestination(
      repoRoot,
      destination,
      label,
      maxBytes,
      requirePrivateDestination,
    )
    await Deno.rename(temporaryPath, destination)
  } catch (cause) {
    try {
      await Deno.remove(temporaryPath)
    } catch (cleanupCause) {
      if (!(cleanupCause instanceof Deno.errors.NotFound)) {
        throw new AggregateError([cause, cleanupCause], `Failed to write ${label}`)
      }
    }
    throw cause
  }
}

export async function encryptEnvironments(options: EnvOperationOptions = {}): Promise<void> {
  const manifest = await loadEnvManifest(options.repoRoot ?? Deno.cwd(), options.manifestPath)
  const sopsConfig = await loadSopsConfig(manifest, options.sopsConfigPath)

  for (const [index, entry] of manifest.files.entries()) {
    const example = await readVerifiedTextFile(
      entry.examplePath,
      "Manifest example",
      MAX_ENV_FILE_BYTES,
    )
    const exampleValues = assertDotenvBounds(example.content, "Manifest example")
    const plaintext = await readVerifiedTextFile(
      entry.plaintextPath,
      "Manifest plaintext",
      MAX_ENV_FILE_BYTES,
    )
    if (plaintext.info.mode !== null && (plaintext.info.mode & 0o077) !== 0) {
      throw new EnvWorkflowError("Manifest plaintext has unsafe permissions; expected mode 0600")
    }
    const values = assertDotenvBounds(plaintext.content, "Manifest plaintext")
    assertExactEnvKeys(values, exampleValues, "Manifest plaintext")
    assertRequiredValues(values, entry.requiredValues, "Manifest plaintext")
    assertPlaintextValuesReady(values, exampleValues, "Manifest plaintext")

    const result = await runCommand([
      "sops",
      "--config",
      "/dev/null",
      "encrypt",
      "--age",
      sopsConfig.rules[index].ageRecipient,
      "--input-type",
      "dotenv",
      "--output-type",
      "dotenv",
      "--filename-override",
      entry.plaintext,
      "/dev/stdin",
    ], {
      cwd: manifest.repoRoot,
      env: options.processEnv,
      clearEnv: options.processEnv !== undefined,
      stdin: plaintext.bytes,
      maxOutputBytes: MAX_CIPHERTEXT_BYTES,
    })
    if (!result.success) {
      throw new EnvWorkflowError(
        `SOPS encryption failed for ${entry.plaintext}: ${truncatedSopsStderr(result.stderr)}`,
      )
    }
    assertSopsDotenvCiphertext(
      result.stdout,
      Object.keys(exampleValues),
      sopsConfig.rules[index].ageRecipient,
      `SOPS encryption output for ${entry.plaintext}`,
    )
    await atomicWrite(
      manifest.repoRoot,
      entry.ciphertextPath,
      "Manifest ciphertext destination",
      result.stdout,
      0o644,
      MAX_CIPHERTEXT_BYTES,
      false,
    )
  }
}

export async function decryptEnvironments(options: EnvOperationOptions = {}): Promise<void> {
  const manifest = await loadEnvManifest(options.repoRoot ?? Deno.cwd(), options.manifestPath)
  const sopsConfig = await loadSopsConfig(manifest, options.sopsConfigPath)

  for (const [index, entry] of manifest.files.entries()) {
    const example = await readVerifiedTextFile(
      entry.examplePath,
      "Manifest example",
      MAX_ENV_FILE_BYTES,
    )
    const exampleValues = assertDotenvBounds(example.content, "Manifest example")
    const ciphertext = await readVerifiedTextFile(
      entry.ciphertextPath,
      "Manifest ciphertext",
      MAX_CIPHERTEXT_BYTES,
    )
    assertSopsDotenvCiphertext(
      ciphertext.content,
      Object.keys(exampleValues),
      sopsConfig.rules[index].ageRecipient,
      `Manifest ciphertext ${entry.ciphertext}`,
    )
    await assertReplaceableDestination(
      manifest.repoRoot,
      entry.plaintextPath,
      "Manifest plaintext destination",
      MAX_ENV_FILE_BYTES,
      true,
    )

    const result = await runCommand([
      "sops",
      "decrypt",
      "--input-type",
      "dotenv",
      "--output-type",
      "dotenv",
      "--filename-override",
      entry.ciphertext,
      "/dev/stdin",
    ], {
      cwd: manifest.repoRoot,
      env: options.processEnv,
      clearEnv: options.processEnv !== undefined,
      stdin: ciphertext.bytes,
      maxOutputBytes: MAX_ENV_FILE_BYTES,
    })
    if (!result.success) {
      throw new EnvWorkflowError(
        `SOPS decryption or MAC verification failed for ${entry.ciphertext}: ${
          truncatedSopsStderr(result.stderr)
        }`,
      )
    }
    const values = assertDotenvBounds(result.stdout, "Decrypted dotenv output")
    assertExactEnvKeys(values, exampleValues, "Decrypted dotenv output")
    assertRequiredValues(values, entry.requiredValues, "Decrypted dotenv output")
    await atomicWrite(
      manifest.repoRoot,
      entry.plaintextPath,
      "Manifest plaintext destination",
      result.stdout,
      0o600,
      MAX_ENV_FILE_BYTES,
      true,
    )
  }
}
