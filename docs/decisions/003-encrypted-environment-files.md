# ADR 003: Encrypt environment files with SOPS and age

- Status: accepted
- Date: 2026-08-20
- Maintainer: architecture owners
- Location: `docs/decisions/003-encrypted-environment-files.md`
- Related inventory:
  [homelab tooling extraction](https://github.com/spy4x/template/blob/main/docs/homelab-extraction-inventory.md)

## Context

Repository needs encrypted environment files that can be committed without
committing decryption keys or plaintext credentials. Homelab's age64 v1
implementation optimized stable diffs by encrypting each value independently.

That implementation is not copied. Its parser accepts ordinary `KEY=VALUE` lines
in an encrypted file and decrypt passes those lines through unchanged
(`../homelab/scripts/encryption/age-lib.ts:155-179`,
`../homelab/scripts/encryption/decrypt.ts:47-61`). Its Git hooks automatically
decrypt after checkout and merge (`../homelab/deno.jsonc:56-62`). It
authenticates individual encrypted values but has no whole-file integrity
(`../homelab/docs/ENCRYPTED_ENV_FILES.md:115-120`). An attacker or merge can
therefore remove, reorder, duplicate, or replace plaintext lines without a
file-level integrity failure.

SOPS provides authenticated structured-file encryption and age recipients. Its
ciphertext changes more broadly than per-value stable encryption, but integrity
and explicit operation are required for this template.

## Decision

1. Committed environment ciphertext uses [SOPS](https://github.com/getsops/sops)
   with [age](https://age-encryption.org/).
2. `infra/envs/encrypted-files.json` is the explicit manifest of every managed
   plaintext path, ciphertext path, example path, and required non-secret
   values. Encryption and decryption process only listed entries. They do not
   discover files by walking the repository. Production entries require
   `ENV=prod` before encryption and after decryption.
3. `.sops.yaml` contains creation rules and public age recipients only. It
   contains no private key, password, token, or raw environment value.
4. Private age keys are never committed or copied by repository automation.
   Operators provide an external key through SOPS-supported configuration, such
   as `SOPS_AGE_KEY_FILE` pointing outside the repository.
5. `deno task env:encrypt` and `deno task env:decrypt` are explicit operator
   actions. No post-checkout, post-merge, shell-startup, or editor hook may
   decrypt automatically. Pre-commit may validate ciphertext and plaintext
   absence, but may not encrypt or decrypt.
6. Decryption writes a temporary file in the plaintext file's directory with
   mode `0600`, completes and validates the write, then atomically renames it
   over the destination. Failure leaves the previous plaintext file unchanged.
   Plaintext paths remain ignored by Git.
7. Encryption must fail when a manifest plaintext file is absent, recipient
   configuration is invalid, or a destination is not a regular file.
   Decryption must fail on missing ciphertext, a missing key, failed SOPS
   integrity check, or unsafe destination permissions.
8. Stable-diff age64 v2 is deferred. It requires a new ADR and must provide
   mandatory encryption, explicit execution, atomic `0600` plaintext output, and
   whole-file integrity equivalent to the SOPS MAC before consideration.
9. Encryption tooling remains repository-local. JSR publication is deferred
   until an accepted API ADR and successful use in at least two independent
   repositories.

## Consequences

- SOPS MAC verification detects whole-file tampering before plaintext
  replacement.
- Explicit manifest prevents broad filesystem scans and makes review scope
  visible.
- Checkout and merge do not execute decryption or mutate local plaintext.
- Lost private keys make ciphertext unrecoverable; key custody and backup remain
  operator duties.
- SOPS may re-encrypt multiple values when one value changes. Reviews have
  noisier ciphertext diffs than age64 v1, accepted in exchange for whole-file
  integrity.
- Contributors without a private key can inspect examples and ciphertext but
  cannot run secret-dependent tasks.
- Recipient rotation rewrites ciphertext and requires a coordinated
  key-distribution change.

## Implementation

- Creation rules: `.sops.yaml`.
- Explicit versioned manifest: `infra/envs/encrypted-files.json`.
- Commands: `deno task env:encrypt`, `deno task env:decrypt`, and
  `deno task env:check`.
- Implementation and tests: `infra/scripts/env/`.
- Initial template state intentionally has a public recipient placeholder and
  no ciphertext. `env:check` reports exact initialization action and succeeds;
  `env:encrypt` rejects the placeholder. Once any ciphertext exists, placeholder
  configuration is a policy error.
- `env:check` parses ciphertext without private key and rejects malformed,
  appended, plaintext, or unsupported dotenv assignments. SOPS decryption
  remains MAC verification path.

## Maintenance

Architecture owners maintain this record. Add a new ADR and mark this one
superseded if encryption format, manifest schema, task names, key custody,
automatic execution policy, plaintext write mode, stable-diff design, or JSR
distribution gate changes. Update manifest and environment operations docs
whenever code adds, moves, or removes a managed environment file.
