import { decryptEnvFiles, encryptEnvFiles } from "./age.ts"

try {
  const command = Deno.args[0]
  if (command !== `encrypt` && command !== `decrypt`) {
    throw new Error(`usage: env <encrypt|decrypt>`)
  }
  const count = command === `encrypt`
    ? await encryptEnvFiles(Deno.cwd())
    : await decryptEnvFiles(Deno.cwd())
  console.log(`${command}ed ${count} env file(s)`)
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error))
  Deno.exit(1)
}
