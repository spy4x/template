# Homelab tooling extraction inventory

- Status: accepted for staged extraction
- Compiled: 2026-08-20 from homelab commit
  `7e83a876da6e77eba45f0ff79805590a12f51f9c`
- Maintainer: docs owner
- Location: `docs/homelab-extraction-inventory.md`

This inventory selects reusable operations code without copying homelab server
topology, credentials workflow, or recovery assumptions. `../homelab/...`
citations are local sibling-repository evidence, not published links.

## Land now

### Process runner

- **Source:** Argument arrays, working directory, stdin policy, captured output,
  and exit status in `../homelab/scripts/+lib.ts:55-75`.
- **Destination:** `libs/platform/process/`.
- **Adaptation:** Typed argv and result, explicit stream modes and environment,
  no default shell, and failure errors that omit arguments and environment
  values.
- **Verification:** `libs/platform/process/+lib.test.ts:6-65`; run
  `deno test --allow-run=deno libs/platform/process/+lib.test.ts` and
  `deno task check`.

### Encrypted environment files

- **Source:** age64 v1 accepts and preserves plaintext values
  (`../homelab/scripts/encryption/age-lib.ts:155-179`,
  `../homelab/scripts/encryption/decrypt.ts:47-61`), decrypts automatically
  after checkout and merge (`../homelab/deno.jsonc:56-62`), and lacks whole-file
  integrity (`../homelab/docs/ENCRYPTED_ENV_FILES.md:115-120`).
- **Destination:** `.sops.yaml`, `infra/envs/encrypted-files.json`, env tasks in
  `deno.jsonc`, and
  [ADR 003](https://github.com/spy4x/template/blob/main/docs/decisions/003-encrypted-environment-files.md).
- **Adaptation:** Do not copy age64 v1. Use SOPS with age, explicit manifest
  entries, explicit commands, atomic plaintext replacement with mode `0600`, and
  no committed private key. Defer stable-diff age64 v2.
- **Verification:** Round-trip every manifest entry; reject missing ciphertext,
  unlisted plaintext, invalid SOPS MACs, and unsafe output mode. Run
  `deno task check`.

## Follow-up template PR

### Remote execution

- **Source:** Server validation, local connection data, interactive/captured
  modes, and SSH exit propagation in `../homelab/scripts/ssh/+main.ts:15-42`,
  `../homelab/scripts/ssh/+main.ts:44-67`, and
  `../homelab/scripts/ssh/+main.ts:77-118`.
- **Destination:** `infra/scripts/remote/`.
- **Adaptation:** Build on `@platform/process`. Accept structured host config
  and argument arrays; do not concatenate shell strings or infer hosts by
  scanning product directories.
- **Verification:** Fake-SSH tests for invalid target, argument preservation,
  non-zero exit, no TTY, and host-key failure.

### Deploy orchestration

- **Source:** Config selection, staging, hooks, rsync, one-session deployment,
  and result markers in `../homelab/scripts/deploy/+main.ts:46-72`,
  `../homelab/scripts/deploy/+main.ts:74-134`,
  `../homelab/scripts/deploy/+main.ts:136-233`, and
  `../homelab/scripts/deploy/+main.ts:253-367`; tests in
  `../homelab/scripts/deploy/deploy.test.ts:11-67` and
  `../homelab/scripts/deploy/deploy.test.ts:154-176`.
- **Destination:** `infra/scripts/deploy/` and `infra/deploy/manifest.json`.
- **Adaptation:** Preserve manifest selection, staging, checksums, and per-unit
  results. Replace homelab stack names, `hl-` cleanup, broad hook permissions,
  plaintext env copying, and generated remote shell with template app units and
  explicit hooks.
- **Verification:** Unit-test whitelist, quoted paths, checksums, partial
  failure, and hook failure; integration-test disposable SSH and Compose targets
  before replacing `deno task deploy`.

### CI and security checks

- **Source:** Pinned-Deno Woodpecker check in `../homelab/.woodpecker.yml:1-5`
  and composed checks in `../homelab/deno.jsonc:65-99`.
- **Destination:** Root `.woodpecker.yml` and `infra/scripts/checks/`.
- **Adaptation:** Run `deno task check`; add plaintext-env, manifest-parity,
  private-key, Compose, and image-pin checks. Do not copy GitGuardian rules that
  suppress all encrypted env paths (`../homelab/.gitguardian.yml:7-14`).
- **Verification:** Run identical local and Woodpecker tasks; each security
  fixture must prove one known violation fails.

### Restic backup and reporting

- **Source:** Config discovery in
  `../homelab/scripts/backup/src/config.ts:184-202`; repository init, pre/post
  checks, retention, and ownership in
  `../homelab/scripts/backup/src/operations.ts:143-217`; guaranteed container
  restart in `../homelab/scripts/backup/+main.ts:133-161`; Healthchecks and ntfy
  reporting in `../homelab/scripts/backup/src/reporting.ts:7-121`.
- **Destination:** `infra/scripts/backup/`, `infra/backup/manifest.json`, and
  `infra/scripts/backup/reporting.ts`.
- **Adaptation:** Use an explicit manifest, keep Restic password in process
  environment, preserve integrity checks and guaranteed restart, and define
  retention per repository. Reporting stays optional, redacted, bounded, and
  fail-open.
- **Verification:** Test invalid config, initialization, Restic exit codes,
  retention arguments, interruption, guaranteed restart, and failed/timed-out
  reporters. Prove backup and restore with a disposable Restic repository.

### Restore and disaster recovery

- **Source:** Snapshot selection and preservation of current data in
  `../homelab/scripts/backup/restore.ts:55-134`; destructive recovery
  classification and confirmation in
  `../homelab/scripts/backup/recover.ts:37-71`.
- **Destination:** `infra/scripts/backup/restore.ts`, `docs/restore.md`, and
  `docs/disaster-recovery.md`.
- **Adaptation:** Restore into a sibling staging directory, verify, then
  atomically swap. Recovery defaults to inspection; destructive repair requires
  a named repository, fresh secondary copy, and explicit flag.
- **Verification:** Disposable-repository tests for latest/selected snapshots,
  failed-restore data preservation, and rollback. Quarterly drill records
  recovery point and recovery time.

## Future JSR after ADR gate

- **Process runner:** Accepted API ADR after deploy and backup use it here and
  one independent repository. Publish process spawn, cancellation, timeout, and
  typed results only. Gate with `deno doc --lint`, examples copied from tests,
  and supported-Deno compatibility tests.
- **Restic orchestration:** Accepted backup ADR after two deployments prove
  manifest, retention, failure, and restore contracts. Publish command
  construction and typed results only. Gate with a disposable-repository suite
  and restore drill per adopter.
- **Stable-diff age64 v2:** New security ADR proving mandatory ciphertext,
  explicit invocation, atomic `0600` plaintext, and whole-file integrity
  equivalent to SOPS MAC. Gate with tamper, truncation, key-substitution,
  plaintext-injection, and interrupted-write tests.

These gates follow Stage 2 in
[ADR 001](https://github.com/spy4x/template/blob/main/docs/decisions/001-deno-platform-template.md).

## Reject or leave in homelab

- **age64 v1 and automatic hooks:** Reject. Evidence:
  `../homelab/scripts/encryption/decrypt.ts:47-61`,
  `../homelab/deno.jsonc:56-62`, and
  `../homelab/docs/ENCRYPTED_ENV_FILES.md:115-120`.
- **Current restore implementation:** Reject direct copy. It consumes
  unnormalized `"default"` values as iterables and copies the staging root
  rather than a verified source path
  (`../homelab/scripts/backup/restore.ts:84-119`; normalization exists only in
  `../homelab/scripts/backup/src/config.ts:16-43`).
- **Current repository recovery:** Leave. It deletes all snapshot/index/lock
  data for partial repositories and whole repositories for broken ones
  (`../homelab/scripts/backup/recover.ts:138-194`).
- **Offline-drive backup and restore:** Leave. It assumes Linux block devices,
  one `${device}1` partition, Btrfs, `udisksctl`, SMART, interactive prompts,
  and destructive rsync mirroring
  (`../homelab/scripts/offline-backup/src/drive.ts:54-155`,
  `../homelab/scripts/offline-backup/src/sync.ts:47-115`,
  `../homelab/scripts/offline-backup/src/restore.ts:115-158`).
- **Ansible provisioning and backup cron:** Leave. Inventory derives hosts and
  paths from homelab server folders; playbooks assume root cron, local Deno
  paths, and homelab ownership policy
  (`../homelab/scripts/ansible/inventory.ts:25-51`,
  `../homelab/scripts/ansible/inventory.ts:86-141`,
  `../homelab/ansible/playbooks/after-deploy/backup-cronjob.yml:17-76`).
- **Service catalog and deploy hooks:** Leave. Stack names, container cleanup,
  network names, and hook permissions encode one fleet
  (`../homelab/scripts/deploy/src/+lib.ts:69-114`,
  `../homelab/scripts/deploy/+main.ts:169-233`).

## Maintenance

Docs owner updates this file when an extraction lands, destination or
verification changes, an ADR changes a gate, or cited homelab code changes
materially. Record landed PR URLs beside affected items. Delete this migration
inventory after every item is resolved.
