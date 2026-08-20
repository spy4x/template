import { expect } from "@std/expect"
import { runCommand } from "@platform/process"
import { checkEnvironments } from "./check.ts"
import { EnvWorkflowError } from "./config.ts"
import { encryptEnvironments } from "./operations.ts"

interface CheckFixture {
  root: string
  keyPath: string
  ciphertextPath: string
}

async function runRequired(argv: readonly [string, ...string[]], cwd?: string): Promise<string> {
  const result = await runCommand(argv, { cwd, stderr: "null" })
  if (!result.success) throw new Error(`Test command failed: ${argv[0]}`)
  return result.stdout
}

async function makeCheckFixture(realRecipient: boolean): Promise<CheckFixture> {
  const root = await Deno.makeTempDir({ prefix: "env-check-test-" })
  const envDirectory = `${root}/infra/envs`
  await Deno.mkdir(envDirectory, { recursive: true })
  const keyPath = `${root}/operator-key.txt`
  await runRequired(["age-keygen", "-o", keyPath])
  const recipient = realRecipient
    ? (await runRequired(["age-keygen", "-y", keyPath])).trim()
    : "REPLACE_WITH_AGE_RECIPIENT"
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
  await Deno.writeTextFile(
    `${envDirectory}/.env.example`,
    "ENV=dev\nSECRET=REPLACE_WITH_SECRET\n",
  )
  await Deno.writeTextFile(
    `${root}/.gitignore`,
    ".age/\n.env\n.env.*\n**/.env\n**/.env.*\n!**/.env.example\n!infra/envs/.env.prod.age\n",
  )
  await runRequired(["git", "init", "--quiet"], root)
  return { root, keyPath, ciphertextPath: `${envDirectory}/.env.prod.age` }
}

function isolatedSopsEnvironment(fixture: CheckFixture): Readonly<Record<string, string>> {
  return {
    SOPS_AGE_KEY: "",
    SOPS_AGE_KEY_FILE: fixture.keyPath,
    HOME: `${fixture.root}/empty-home`,
    XDG_CONFIG_HOME: `${fixture.root}/empty-config`,
  }
}

Deno.test("env check accepts SOPS comments and export, then rejects plaintext append", async () => {
  const fixture = await makeCheckFixture(true)
  try {
    const plaintextPath = `${fixture.root}/infra/envs/.env.prod`
    await Deno.writeTextFile(
      plaintextPath,
      "# production values\nexport ENV=prod\nSECRET=value\n# encrypted trailing comment\n",
    )
    await Deno.chmod(plaintextPath, 0o600)
    await encryptEnvironments({
      repoRoot: fixture.root,
      processEnv: isolatedSopsEnvironment(fixture),
    })
    const ciphertext = await Deno.readTextFile(fixture.ciphertextPath)
    expect(ciphertext).toMatch(/^#ENC\[.+,type:comment\]$/m)
    expect(ciphertext).toMatch(/^export ENV=ENC\[.+,type:str\]$/m)
    await checkEnvironments({ repoRoot: fixture.root, report: () => {} })

    for (
      const appended of [
        "# plaintext comment\n",
        "SECRET=plaintext\n",
        "APPENDED=ENC[AES256_GCM,data:QQ==,iv:QQ==,tag:QQ==,type:str]\n",
        "MALFORMED\n",
      ]
    ) {
      await Deno.writeTextFile(fixture.ciphertextPath, ciphertext + appended)
      await expect(checkEnvironments({ repoRoot: fixture.root })).rejects.toThrow(EnvWorkflowError)
    }
  } finally {
    await Deno.remove(fixture.root, { recursive: true })
  }
})

Deno.test("env check rejects ciphertext for another configured recipient", async () => {
  const fixture = await makeCheckFixture(true)
  try {
    const plaintextPath = `${fixture.root}/infra/envs/.env.prod`
    await Deno.writeTextFile(plaintextPath, "ENV=prod\nSECRET=value\n")
    await Deno.chmod(plaintextPath, 0o600)
    await encryptEnvironments({
      repoRoot: fixture.root,
      processEnv: isolatedSopsEnvironment(fixture),
    })

    const wrongKeyPath = `${fixture.root}/wrong-recipient-key.txt`
    await runRequired(["age-keygen", "-o", wrongKeyPath])
    const wrongRecipient = (await runRequired(["age-keygen", "-y", wrongKeyPath])).trim()
    await Deno.writeTextFile(
      `${fixture.root}/.sops.yaml`,
      `creation_rules:\n  - path_regex: ^infra/envs/\\.env\\.prod$\n    age: ${wrongRecipient}\n`,
    )

    await expect(checkEnvironments({ repoRoot: fixture.root })).rejects.toThrow(
      "SOPS age recipient does not match .sops.yaml",
    )
  } finally {
    await Deno.remove(fixture.root, { recursive: true })
  }
})

Deno.test("env check requires exact ciphertext application keys", async () => {
  const fixture = await makeCheckFixture(true)
  try {
    const plaintextPath = `${fixture.root}/infra/envs/.env.prod`
    await Deno.writeTextFile(plaintextPath, "ENV=prod\nSECRET=value\n")
    await Deno.chmod(plaintextPath, 0o600)
    await encryptEnvironments({
      repoRoot: fixture.root,
      processEnv: isolatedSopsEnvironment(fixture),
    })
    const ciphertext = await Deno.readTextFile(fixture.ciphertextPath)
    const secretValue = ciphertext.match(/^SECRET=(.+)$/m)?.[1]
    if (secretValue === undefined) throw new Error("Real SOPS fixture omitted SECRET")

    await Deno.writeTextFile(fixture.ciphertextPath, ciphertext.replace(/^SECRET=.+\n/m, ""))
    await expect(checkEnvironments({ repoRoot: fixture.root })).rejects.toThrow("missing SECRET")

    await Deno.writeTextFile(
      fixture.ciphertextPath,
      ciphertext.replace(/^sops_age/m, `EXTRA=${secretValue}\nsops_age`),
    )
    await expect(checkEnvironments({ repoRoot: fixture.root })).rejects.toThrow("unexpected EXTRA")
  } finally {
    await Deno.remove(fixture.root, { recursive: true })
  }
})

Deno.test("env check rejects tracked plaintext and unlisted ciphertext", async () => {
  for (const trackedPath of ["infra/envs/.env.leak", "infra/envs/.env.stag.age"]) {
    const fixture = await makeCheckFixture(false)
    try {
      await Deno.writeTextFile(`${fixture.root}/${trackedPath}`, "not-a-secret\n")
      await runRequired(["git", "add", "--force", "--", trackedPath], fixture.root)
      await expect(checkEnvironments({ repoRoot: fixture.root })).rejects.toThrow(
        trackedPath.endsWith(".age") ? "not in manifest" : "Tracked plaintext",
      )
    } finally {
      await Deno.remove(fixture.root, { recursive: true })
    }
  }
})
