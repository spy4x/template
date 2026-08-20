import { checkEnvironments } from "./check.ts"
import { EnvWorkflowError } from "./config.ts"
import { decryptEnvironments, encryptEnvironments } from "./operations.ts"

async function main(): Promise<void> {
  const [operation, ...extraArguments] = Deno.args
  if (extraArguments.length > 0 || !["encrypt", "decrypt", "check"].includes(operation)) {
    throw new EnvWorkflowError("Usage: env/+main.ts <encrypt|decrypt|check>")
  }
  if (operation === "encrypt") {
    await encryptEnvironments()
    console.log("Encrypted manifest environment files.")
  } else if (operation === "decrypt") {
    await decryptEnvironments()
    console.log("Decrypted manifest environment files with mode 0600.")
  } else {
    await checkEnvironments()
  }
}

try {
  await main()
} catch (cause) {
  if (cause instanceof EnvWorkflowError) {
    console.error(cause.message)
  } else {
    console.error("Environment operation failed")
  }
  Deno.exit(1)
}
