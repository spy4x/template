import { expect } from "@std/expect"
import { EnvWorkflowError, loadEnvManifest, loadSopsConfig } from "./config.ts"
import { createTestSymlink } from "./test-helpers.ts"

async function makeManifestFixture(manifest: unknown): Promise<string> {
  const root = await Deno.makeTempDir({ prefix: "env-manifest-test-" })
  await Deno.mkdir(`${root}/infra/envs`, { recursive: true })
  await Deno.writeTextFile(
    `${root}/infra/envs/encrypted-files.json`,
    JSON.stringify(manifest),
  )
  return root
}

Deno.test("environment manifest rejects absolute and traversal paths", async () => {
  for (const plaintext of ["/tmp/.env.prod", "infra/envs/../.env.prod"]) {
    const root = await makeManifestFixture({
      version: 1,
      files: [{
        plaintext,
        ciphertext: "infra/envs/.env.prod.age",
        example: "infra/envs/.env.example",
        requiredValues: { ENV: "prod" },
      }],
    })
    try {
      await expect(loadEnvManifest(root)).rejects.toThrow(EnvWorkflowError)
    } finally {
      await Deno.remove(root, { recursive: true })
    }
  }
})

Deno.test("environment manifest rejects duplicate paths across fields", async () => {
  const root = await makeManifestFixture({
    version: 1,
    files: [
      {
        plaintext: "infra/envs/.env.prod",
        ciphertext: "infra/envs/.env.prod.age",
        example: "infra/envs/.env.example",
        requiredValues: { ENV: "prod" },
      },
      {
        plaintext: "infra/envs/.env.stag",
        ciphertext: "infra/envs/.env.stag.age",
        example: "infra/envs/.env.example",
        requiredValues: { ENV: "stag" },
      },
    ],
  })
  try {
    await expect(loadEnvManifest(root)).rejects.toThrow("duplicate path")
  } finally {
    await Deno.remove(root, { recursive: true })
  }
})

Deno.test("environment manifest rejects parent symlink escaping repository", async () => {
  const root = await Deno.makeTempDir({ prefix: "env-manifest-root-" })
  const outside = await Deno.makeTempDir({ prefix: "env-manifest-outside-" })
  try {
    await Deno.mkdir(`${root}/infra`, { recursive: true })
    await createTestSymlink(outside, `${root}/infra/envs`)
    await Deno.writeTextFile(
      `${outside}/encrypted-files.json`,
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

    await expect(loadEnvManifest(root)).rejects.toThrow("resolves outside repository")
  } finally {
    await Deno.remove(root, { recursive: true })
    await Deno.remove(outside, { recursive: true })
  }
})

Deno.test("SOPS config placeholder is check-only and rejected for encryption", async () => {
  const root = await makeManifestFixture({
    version: 1,
    files: [{
      plaintext: "infra/envs/.env.prod",
      ciphertext: "infra/envs/.env.prod.age",
      example: "infra/envs/.env.example",
      requiredValues: { ENV: "prod" },
    }],
  })
  try {
    await Deno.writeTextFile(
      `${root}/.sops.yaml`,
      "creation_rules:\n  - path_regex: ^infra/envs/\\.env\\.prod$\n    age: REPLACE_WITH_AGE_RECIPIENT\n",
    )
    const manifest = await loadEnvManifest(root)
    expect((await loadSopsConfig(manifest, undefined, true)).usesPlaceholder).toBe(true)
    await expect(loadSopsConfig(manifest)).rejects.toThrow("before encryption")
  } finally {
    await Deno.remove(root, { recursive: true })
  }
})

Deno.test("SOPS config rejects unsupported root and rule keys", async () => {
  const root = await makeManifestFixture({
    version: 1,
    files: [{
      plaintext: "infra/envs/.env.prod",
      ciphertext: "infra/envs/.env.prod.age",
      example: "infra/envs/.env.example",
      requiredValues: { ENV: "prod" },
    }],
  })
  try {
    const manifest = await loadEnvManifest(root)
    await Deno.writeTextFile(
      `${root}/.sops.yaml`,
      "creation_rules: []\npgp: forbidden\n",
    )
    await expect(loadSopsConfig(manifest, undefined, true)).rejects.toThrow(
      "unsupported or missing fields",
    )

    for (const key of ["pgp", "kms", "unencrypted_regex", "encrypted_regex", "unknown"]) {
      await Deno.writeTextFile(
        `${root}/.sops.yaml`,
        `creation_rules:\n  - path_regex: ^infra/envs/\\.env\\.prod$\n    age: REPLACE_WITH_AGE_RECIPIENT\n    ${key}: forbidden\n`,
      )
      await expect(loadSopsConfig(manifest, undefined, true)).rejects.toThrow(
        "unsupported or missing fields",
      )
    }
  } finally {
    await Deno.remove(root, { recursive: true })
  }
})

Deno.test("SOPS config requires one exact ordered rule per manifest entry", async () => {
  const root = await makeManifestFixture({
    version: 1,
    files: [
      {
        plaintext: "infra/envs/.env.prod",
        ciphertext: "infra/envs/.env.prod.age",
        example: "infra/envs/.env.prod.example",
        requiredValues: { ENV: "prod" },
      },
      {
        plaintext: "infra/envs/.env.stag",
        ciphertext: "infra/envs/.env.stag.age",
        example: "infra/envs/.env.stag.example",
        requiredValues: { ENV: "stag" },
      },
    ],
  })
  try {
    await Deno.writeTextFile(
      `${root}/.sops.yaml`,
      "creation_rules:\n  - path_regex: ^infra/envs/\\.env\\.stag$\n    age: REPLACE_WITH_AGE_RECIPIENT\n  - path_regex: ^infra/envs/\\.env\\.prod$\n    age: REPLACE_WITH_AGE_RECIPIENT\n",
    )
    const manifest = await loadEnvManifest(root)
    await expect(loadSopsConfig(manifest, undefined, true)).rejects.toThrow(
      "rule 1 must match only",
    )
  } finally {
    await Deno.remove(root, { recursive: true })
  }
})

Deno.test("production manifest requires ENV=prod", async () => {
  const root = await makeManifestFixture({
    version: 1,
    files: [{
      plaintext: "infra/envs/.env.prod",
      ciphertext: "infra/envs/.env.prod.age",
      example: "infra/envs/.env.example",
      requiredValues: { ENV: "dev" },
    }],
  })
  try {
    await expect(loadEnvManifest(root)).rejects.toThrow("must require ENV=prod")
  } finally {
    await Deno.remove(root, { recursive: true })
  }
})
