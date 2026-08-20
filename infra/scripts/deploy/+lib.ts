import { CommandArgv, runCommand, RunCommandOptions, RunCommandResult } from "@platform/process"

export interface DeployConfig {
  sshTarget: string
  remotePath: string
}

export interface DeployCommand {
  argv: CommandArgv
  options: RunCommandOptions
}

export interface DeployPlan {
  rsync: DeployCommand
  ssh: DeployCommand
}

export interface DeployRunDependencies {
  runCommand?: (argv: CommandArgv, options?: RunCommandOptions) => Promise<RunCommandResult>
  log?: (message: string) => void
}

export class DeployConfigError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "DeployConfigError"
  }
}

export class DeployStepError extends Error {
  readonly step: "rsync" | "ssh"
  readonly code: number

  constructor(step: "rsync" | "ssh", code: number) {
    super(step === "rsync" ? "rsync failed" : "Remote SSH command failed")
    this.name = "DeployStepError"
    this.step = step
    this.code = code
  }
}

function posixQuote(value: string): string {
  return `'${value.replace(/'/g, `'"'"'`)}'`
}

function isSafeRemotePath(path: string): boolean {
  if (!path.startsWith("/") || path === "/" || path.includes("\0")) return false
  const segments = path.split("/").slice(1)
  if (segments.at(-1) === "") segments.pop()
  return segments.length > 0 &&
    segments.every((segment) =>
      segment !== "." && segment !== ".." && /^[A-Za-z0-9._-]+$/.test(segment)
    )
}

function isSafeSshTarget(target: string): boolean {
  return target.length > 0 && !target.startsWith("-") && !/[\s\0:]/.test(target)
}

export function createDeployPlan(config: DeployConfig): DeployPlan {
  if (!config.sshTarget || !config.remotePath) {
    throw new DeployConfigError(
      "SSH_TO_SERVER and PATH_ON_SERVER must be set in ./infra/envs/.env.prod",
    )
  }
  if (!isSafeSshTarget(config.sshTarget)) {
    throw new DeployConfigError("SSH_TO_SERVER must be a safe SSH target")
  }
  if (!isSafeRemotePath(config.remotePath)) {
    throw new DeployConfigError(
      "PATH_ON_SERVER must be an absolute non-root path containing only safe path characters",
    )
  }

  const streamOptions = { stdout: "inherit", stderr: "inherit" } as const
  const remoteCommand = `cd ${
    posixQuote(config.remotePath)
  } && mv ./infra/envs/.env.prod ./infra/envs/.env && source ~/.zshrc && deno task compose up -d --build`
  return {
    rsync: {
      argv: [
        "rsync",
        "-avhzru",
        "-e",
        "ssh",
        ".",
        `${config.sshTarget}:${config.remotePath}`,
        "--exclude-from=infra/deploy/exclude.txt",
        "--include-from=infra/deploy/include.txt",
        "--include-from=infra/deploy/include.prod.txt",
        "--exclude",
        "*",
      ],
      options: streamOptions,
    },
    ssh: {
      argv: ["ssh", config.sshTarget, remoteCommand],
      options: streamOptions,
    },
  }
}

export async function runDeploy(
  plan: DeployPlan,
  dependencies: DeployRunDependencies = {},
): Promise<void> {
  const execute = dependencies.runCommand ?? runCommand
  const log = dependencies.log ?? console.log

  log("Running rsync...")
  const rsyncResult = await execute(plan.rsync.argv, plan.rsync.options)
  if (!rsyncResult.success) throw new DeployStepError("rsync", rsyncResult.code)

  log("Running remote SSH deploy commands...")
  const sshResult = await execute(plan.ssh.argv, plan.ssh.options)
  if (!sshResult.success) throw new DeployStepError("ssh", sshResult.code)
}
