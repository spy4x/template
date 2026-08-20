import { EnvWorkflowError } from "./config.ts"

const ENCRYPTED_VALUE =
  /^ENC\[AES256_GCM,data:[A-Za-z0-9+/=]+,iv:[A-Za-z0-9+/=]+,tag:[A-Za-z0-9+/=]+,type:str\]$/
const ENCRYPTED_COMMENT =
  /^#ENC\[AES256_GCM,data:[A-Za-z0-9+/=]+,iv:[A-Za-z0-9+/=]+,tag:[A-Za-z0-9+/=]+,type:comment\]$/
const AGE_BLOCK =
  /^-----BEGIN AGE ENCRYPTED FILE-----\\n(?:[A-Za-z0-9+/=]+\\n)+-----END AGE ENCRYPTED FILE-----\\n$/
const AGE_RECIPIENT = /^age1[0-9a-z]{58}$/
const SOPS_VERSION = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/
const METADATA_KEYS = [
  "sops_age__list_0__map_enc",
  "sops_age__list_0__map_recipient",
  "sops_lastmodified",
  "sops_mac",
  "sops_unencrypted_suffix",
  "sops_version",
] as const

function assertMetadataValue(
  key: string,
  value: string,
  expectedAgeRecipient: string,
  label: string,
): void {
  const valid = key === "sops_age__list_0__map_enc"
    ? AGE_BLOCK.test(value)
    : key === "sops_age__list_0__map_recipient"
    ? AGE_RECIPIENT.test(value)
    : key === "sops_lastmodified"
    ? /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(value) &&
      !Number.isNaN(Date.parse(value))
    : key === "sops_mac"
    ? ENCRYPTED_VALUE.test(value)
    : key === "sops_unencrypted_suffix"
    ? value === "_unencrypted"
    : key === "sops_version"
    ? SOPS_VERSION.test(value)
    : false
  if (!valid) throw new EnvWorkflowError(`${label} contains invalid SOPS metadata: ${key}`)
  if (key === "sops_age__list_0__map_recipient" && value !== expectedAgeRecipient) {
    throw new EnvWorkflowError(`${label} SOPS age recipient does not match .sops.yaml`)
  }
}

export function assertSopsDotenvCiphertext(
  content: string,
  expectedApplicationKeys: readonly string[],
  expectedAgeRecipient: string,
  label: string,
): void {
  const applicationKeys = new Set<string>()
  let metadataIndex = 0
  const lines = content.split(/\r?\n/)

  for (const [index, line] of lines.entries()) {
    if (line === "") {
      if (metadataIndex > 0 && index !== lines.length - 1) {
        throw new EnvWorkflowError(`${label} contains data after SOPS metadata`)
      }
      continue
    }
    if (line.startsWith("#")) {
      if (metadataIndex > 0) {
        throw new EnvWorkflowError(`${label} contains data after SOPS metadata`)
      }
      if (!ENCRYPTED_COMMENT.test(line)) {
        throw new EnvWorkflowError(`${label} contains plaintext or malformed dotenv comment`)
      }
      continue
    }

    const assignment = line.match(/^(?:(export) )?([A-Za-z_][A-Za-z0-9_]*)=(.*)$/)
    if (assignment === null) {
      throw new EnvWorkflowError(`${label} contains malformed dotenv content`)
    }
    const [, exportPrefix, key, value] = assignment
    if (key.startsWith("sops_")) {
      if (exportPrefix !== undefined || key !== METADATA_KEYS[metadataIndex]) {
        throw new EnvWorkflowError(`${label} contains unsupported or out-of-order SOPS metadata`)
      }
      assertMetadataValue(key, value, expectedAgeRecipient, label)
      metadataIndex += 1
      continue
    }
    if (metadataIndex > 0) {
      throw new EnvWorkflowError(`${label} contains application data after SOPS metadata`)
    }
    if (applicationKeys.has(key)) {
      throw new EnvWorkflowError(`${label} contains duplicate application key: ${key}`)
    }
    if (!ENCRYPTED_VALUE.test(value)) {
      throw new EnvWorkflowError(`${label} contains plaintext application value: ${key}`)
    }
    applicationKeys.add(key)
  }

  if (metadataIndex !== METADATA_KEYS.length) {
    throw new EnvWorkflowError(`${label} has incomplete SOPS metadata`)
  }
  const expectedKeys = new Set(expectedApplicationKeys)
  const missingKey = expectedApplicationKeys.find((key) => !applicationKeys.has(key))
  const extraKey = [...applicationKeys].find((key) => !expectedKeys.has(key))
  if (
    applicationKeys.size !== expectedKeys.size || missingKey !== undefined || extraKey !== undefined
  ) {
    const detail = missingKey !== undefined ? `missing ${missingKey}` : `unexpected ${extraKey}`
    throw new EnvWorkflowError(`${label} application keys do not match example: ${detail}`)
  }
}
