import { parse } from "@std/dotenv"
import { runCommand } from "@platform/process"
import { error } from "./+lib.ts"

const envFilePath = "./infra/envs/.env"
let env: string
try {
  env = await Deno.readTextFile(envFilePath)
} catch (cause) {
  if (cause instanceof Deno.errors.NotFound) {
    error(`Env file not found: ${envFilePath}`)
    Deno.exit(1)
  }
  throw cause
}

const envVars = parse(env)
const envName = envVars.ENV
if (!envName || !/^[a-z0-9][a-z0-9._-]*$/.test(envName)) {
  throw new Error(`ENV must be a safe compose environment name in ${envFilePath}`)
}

const args = Deno.args
const composeFile = `./infra/compose/compose.${envName}.yml`
const sharedComposeFile = "./infra/compose/compose.shared.yml"
const containerProvider: "docker" | "podman" = envVars.CONTAINER_PROVIDER === "docker"
  ? "docker"
  : "podman"

// Build base image first if we're doing "up" or "build"
const needsBaseImage = args.includes("up") || args.includes("build")
if (needsBaseImage) {
  console.log("Building base Deno image first...")
  const buildBaseCommand = [
    "compose",
    "-f",
    sharedComposeFile,
    "-f",
    composeFile,
    "--env-file",
    envFilePath,
    "build",
    "deno-base",
  ]
  const buildResult = await runCommand([containerProvider, ...buildBaseCommand], {
    stdout: "inherit",
    stderr: "inherit",
  })
  if (!buildResult.success) {
    console.error("Error building base image")
    Deno.exit(buildResult.code)
  }
  console.log("Base image built successfully")
}

const composeCommand = [
  "compose",
  "-f",
  sharedComposeFile,
  "-f",
  composeFile,
  "--env-file",
  envFilePath,
  ...args,
]
console.log("Compose command:", composeCommand.join(" "))
const result = await runCommand([containerProvider, ...composeCommand], {
  stdout: "inherit",
  stderr: "inherit",
})
if (result.success) {
  console.log("Compose command executed successfully")
} else {
  console.error("Error executing compose command")
  Deno.exit(result.code)
}
