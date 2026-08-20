// Usage: deno run -R=./infra --allow-run=rsync,ssh ./infra/scripts/deploy.ts

import { parse } from "@std/dotenv"
import { error, success } from "./+lib.ts"
import { createDeployPlan, DeployConfigError, DeployStepError, runDeploy } from "./deploy/+lib.ts"

const envFilePath = "./infra/envs/.env.prod"
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
let plan
try {
  plan = createDeployPlan({
    sshTarget: envVars.SSH_TO_SERVER ?? "",
    remotePath: envVars.PATH_ON_SERVER ?? "",
  })
} catch (cause) {
  if (cause instanceof DeployConfigError) {
    error(cause.message)
    Deno.exit(1)
  }
  throw cause
}

try {
  await runDeploy(plan)
} catch (cause) {
  if (cause instanceof DeployStepError) {
    error(cause.message)
    Deno.exit(cause.code)
  }
  throw cause
}

success("Deploy completed successfully.")
