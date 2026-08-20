import { expect } from "@std/expect"
import { runCommand } from "@platform/process"
import { EnvWorkflowError } from "./config.ts"
import { decryptEnvironments, encryptEnvironments, EnvOperationOptions } from "./operations.ts"
import { createTestSymlink } from "./test-helpers.ts"

const PLAINTEXT = [
  "# production values",
  "export ENV=prod",
  "SIMPLE=value",
  'QUOTED="spaces and # signs"',
  "UNICODE=Da Nang",
  "MULTILINE='first\\nsecond'",
  "SECRET=value",
  "# keep encrypted",
  "",
].join("\n")

const EXAMPLE = [
  "ENV=dev",
  "SIMPLE=",
  "QUOTED=",
  "UNICODE=",
  "MULTILINE=",
  "SECRET=REPLACE_WITH_SECRET",
  "",
].join("\n")

interface SopsFixture {
  root: string
  keyPath: string
  plaintextPath: string
  ciphertextPath: string
  examplePath: string
}

async function requireSecurityBinaries(): Promise<void> {
  for (const binary of ["sops", "age-keygen"] as const) {
    const result = await runCommand([binary, "--version"], { stdout: "null", stderr: "null" })
    if (!result.success) throw new Error(`${binary} is required for environment security tests`)
  }
}

await requireSecurityBinaries()

function integrationTest(name: string, fn: () => Promise<void>): void {
  Deno.test(name, fn)
}

async function generateIdentity(path: string): Promise<string> {
  const generate = await runCommand(["age-keygen", "-o", path], {
    stdout: "null",
    stderr: "null",
  })
  if (!generate.success) {
    throw new Error("Could not generate test age identity")
  }
  const recipient = await runCommand(["age-keygen", "-y", path], { stderr: "null" })
  if (!recipient.success) {
    throw new Error("Could not derive test age recipient")
  }
  return recipient.stdout.trim()
}

async function makeSopsFixture(): Promise<SopsFixture> {
  const root = await Deno.makeTempDir({ prefix: "env-sops-test-" })
  const envDirectory = `${root}/infra/envs`
  await Deno.mkdir(envDirectory, { recursive: true })
  const keyPath = `${root}/operator-key.txt`
  const recipient = await generateIdentity(keyPath)
  await Deno.writeTextFile(
    `${root}/.sops.yaml`,
    `creation_rules:\n  - path_regex: ^infra/envs/\\.env\\.prod$\n    age: ${recipient}\n`,
  )
  await Deno.writeTextFile(
    `${envDirectory}/encrypted-files.json`,
    JSON.stringify({
      version: 1,
      files: [{
        plaintext: "infra/envs/.env.prod",
        ciphertext: "infra/envs/.env.prod.age",
        example: "infra/envs/.env.example",
        requiredValues: { ENV: "prod" },
      }],
    }),
  )
  const examplePath = `${envDirectory}/.env.example`
  await Deno.writeTextFile(examplePath, EXAMPLE)
  const plaintextPath = `${envDirectory}/.env.prod`
  await Deno.writeTextFile(plaintextPath, PLAINTEXT)
  await Deno.chmod(plaintextPath, 0o600)
  return {
    root,
    keyPath,
    plaintextPath,
    ciphertextPath: `${envDirectory}/.env.prod.age`,
    examplePath,
  }
}

function isolatedSopsEnvironment(fixture: SopsFixture, keyPath = fixture.keyPath) {
  return {
    SOPS_AGE_KEY: "",
    SOPS_AGE_KEY_FILE: keyPath,
    HOME: `${fixture.root}/empty-home`,
    XDG_CONFIG_HOME: `${fixture.root}/empty-config`,
  }
}

function options(fixture: SopsFixture, keyPath = fixture.keyPath): EnvOperationOptions {
  return {
    repoRoot: fixture.root,
    processEnv: isolatedSopsEnvironment(fixture, keyPath),
  }
}

integrationTest("SOPS dotenv roundtrip preserves output and mode 0600", async () => {
  const fixture = await makeSopsFixture()
  try {
    await encryptEnvironments(options(fixture))
    await encryptEnvironments(options(fixture))
    const expected = await runCommand([
      "sops",
      "decrypt",
      "--input-type",
      "dotenv",
      "--output-type",
      "dotenv",
      fixture.ciphertextPath,
    ], { env: isolatedSopsEnvironment(fixture) })
    expect(expected.success).toBe(true)

    await Deno.writeTextFile(fixture.plaintextPath, "OLD=value\n")
    await Deno.chmod(fixture.plaintextPath, 0o600)
    await decryptEnvironments(options(fixture))

    expect(await Deno.readTextFile(fixture.plaintextPath)).toBe(expected.stdout)
    const mode = (await Deno.stat(fixture.plaintextPath)).mode
    expect(mode === null ? null : mode & 0o777).toBe(0o600)
  } finally {
    await Deno.remove(fixture.root, { recursive: true })
  }
})

integrationTest("missing and wrong SOPS identities preserve prior plaintext", async () => {
  const fixture = await makeSopsFixture()
  try {
    await encryptEnvironments(options(fixture))
    const oldPlaintext = "OLD_SECRET=must-survive\n"
    await Deno.writeTextFile(fixture.plaintextPath, oldPlaintext)
    await Deno.chmod(fixture.plaintextPath, 0o600)

    await expect(
      decryptEnvironments(options(fixture, `${fixture.root}/missing-key.txt`)),
    ).rejects.toThrow(EnvWorkflowError)
    expect(await Deno.readTextFile(fixture.plaintextPath)).toBe(oldPlaintext)

    const wrongKeyPath = `${fixture.root}/wrong-key.txt`
    await generateIdentity(wrongKeyPath)
    await expect(decryptEnvironments(options(fixture, wrongKeyPath))).rejects.toThrow(
      EnvWorkflowError,
    )
    expect(await Deno.readTextFile(fixture.plaintextPath)).toBe(oldPlaintext)
  } finally {
    await Deno.remove(fixture.root, { recursive: true })
  }
})

integrationTest("tampered SOPS MAC preserves prior plaintext", async () => {
  const fixture = await makeSopsFixture()
  try {
    await encryptEnvironments(options(fixture))
    const ciphertext = await Deno.readTextFile(fixture.ciphertextPath)
    const tampered = ciphertext.replace(
      "SIMPLE=ENC[AES256_GCM,data:",
      "SIMPLE=ENC[AES256_GCM,data:X",
    )
    expect(tampered).not.toBe(ciphertext)
    await Deno.writeTextFile(fixture.ciphertextPath, tampered)

    const oldPlaintext = "OLD_SECRET=must-survive\n"
    await Deno.writeTextFile(fixture.plaintextPath, oldPlaintext)
    await Deno.chmod(fixture.plaintextPath, 0o600)
    await expect(decryptEnvironments(options(fixture))).rejects.toThrow(EnvWorkflowError)
    expect(await Deno.readTextFile(fixture.plaintextPath)).toBe(oldPlaintext)
  } finally {
    await Deno.remove(fixture.root, { recursive: true })
  }
})

integrationTest("encryption rejects symlink ciphertext destination", async () => {
  const fixture = await makeSopsFixture()
  try {
    const targetPath = `${fixture.root}/ciphertext-target`
    await Deno.writeTextFile(targetPath, "unchanged")
    await createTestSymlink(targetPath, fixture.ciphertextPath)
    await expect(encryptEnvironments(options(fixture))).rejects.toThrow("not a symlink")
    expect(await Deno.readTextFile(targetPath)).toBe("unchanged")
  } finally {
    await Deno.remove(fixture.root, { recursive: true })
  }
})

integrationTest("decryption rejects symlink and unsafe plaintext destinations", async () => {
  const fixture = await makeSopsFixture()
  try {
    await encryptEnvironments(options(fixture))
    await Deno.remove(fixture.plaintextPath)
    const targetPath = `${fixture.root}/plaintext-target`
    await Deno.writeTextFile(targetPath, "unchanged")
    await createTestSymlink(targetPath, fixture.plaintextPath)
    await expect(decryptEnvironments(options(fixture))).rejects.toThrow("not a symlink")
    expect(await Deno.readTextFile(targetPath)).toBe("unchanged")

    await Deno.remove(fixture.plaintextPath)
    await Deno.writeTextFile(fixture.plaintextPath, "unsafe\n")
    await Deno.chmod(fixture.plaintextPath, 0o644)
    await expect(decryptEnvironments(options(fixture))).rejects.toThrow("unsafe permissions")
    expect(await Deno.readTextFile(fixture.plaintextPath)).toBe("unsafe\n")
  } finally {
    await Deno.remove(fixture.root, { recursive: true })
  }
})

integrationTest("production encryption requires ENV=prod", async () => {
  const fixture = await makeSopsFixture()
  try {
    await Deno.writeTextFile(fixture.plaintextPath, PLAINTEXT.replace("ENV=prod", "ENV=dev"))
    await Deno.chmod(fixture.plaintextPath, 0o600)

    await expect(encryptEnvironments(options(fixture))).rejects.toThrow(
      "Manifest plaintext must set ENV=prod",
    )
    await expect(Deno.lstat(fixture.ciphertextPath)).rejects.toThrow(Deno.errors.NotFound)
  } finally {
    await Deno.remove(fixture.root, { recursive: true })
  }
})

integrationTest("encryption requires exact resolved example keys", async () => {
  const fixture = await makeSopsFixture()
  try {
    for (
      const [plaintext, expectedError] of [
        [PLAINTEXT.replace("SIMPLE=value\n", ""), "missing SIMPLE"],
        [PLAINTEXT.replace("SIMPLE=value", "SIMPLE=value\nEXTRA=value"), "unexpected EXTRA"],
        [
          PLAINTEXT.replace("SIMPLE=value", "SIMPLE=REPLACE_WITH_SIMPLE"),
          "unresolved placeholder: SIMPLE",
        ],
        [PLAINTEXT.replace("SECRET=value", "SECRET="), "credential value must not be empty"],
      ] as const
    ) {
      await Deno.writeTextFile(fixture.plaintextPath, plaintext)
      await Deno.chmod(fixture.plaintextPath, 0o600)
      await expect(encryptEnvironments(options(fixture))).rejects.toThrow(expectedError)
      await expect(Deno.lstat(fixture.ciphertextPath)).rejects.toThrow(Deno.errors.NotFound)
    }
  } finally {
    await Deno.remove(fixture.root, { recursive: true })
  }
})

integrationTest("decryption rejects ciphertext for another configured recipient", async () => {
  const fixture = await makeSopsFixture()
  try {
    await encryptEnvironments(options(fixture))
    const wrongKeyPath = `${fixture.root}/wrong-recipient-key.txt`
    const wrongRecipient = await generateIdentity(wrongKeyPath)
    await Deno.writeTextFile(
      `${fixture.root}/.sops.yaml`,
      `creation_rules:\n  - path_regex: ^infra/envs/\\.env\\.prod$\n    age: ${wrongRecipient}\n`,
    )
    const oldPlaintext = "OLD_SECRET=must-survive\n"
    await Deno.writeTextFile(fixture.plaintextPath, oldPlaintext)
    await Deno.chmod(fixture.plaintextPath, 0o600)

    await expect(decryptEnvironments(options(fixture))).rejects.toThrow(
      "SOPS age recipient does not match .sops.yaml",
    )
    expect(await Deno.readTextFile(fixture.plaintextPath)).toBe(oldPlaintext)
  } finally {
    await Deno.remove(fixture.root, { recursive: true })
  }
})
