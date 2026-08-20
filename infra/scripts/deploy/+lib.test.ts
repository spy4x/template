import { expect } from "@std/expect"
import { CommandArgv, RunCommandOptions, RunCommandResult } from "@platform/process"
import { createDeployPlan, DeployConfigError, DeployStepError, runDeploy } from "./+lib.ts"

const config = { sshTarget: "deploy@example.com", remotePath: "/srv/template-prod" }

function result(success: boolean, code = success ? 0 : 1): RunCommandResult {
  return { success, code, stdout: "", stderr: "" }
}

Deno.test("deploy plan builds exact rsync and SSH commands with inherited streams", () => {
  const plan = createDeployPlan(config)

  expect(plan.rsync).toEqual({
    argv: [
      "rsync",
      "-avhzru",
      "-e",
      "ssh",
      ".",
      "deploy@example.com:/srv/template-prod",
      "--exclude-from=infra/deploy/exclude.txt",
      "--include-from=infra/deploy/include.txt",
      "--include-from=infra/deploy/include.prod.txt",
      "--exclude",
      "*",
    ],
    options: { stdout: "inherit", stderr: "inherit" },
  })
  expect(plan.ssh).toEqual({
    argv: [
      "ssh",
      "deploy@example.com",
      "cd '/srv/template-prod' && mv ./infra/envs/.env.prod ./infra/envs/.env && source ~/.zshrc && deno task compose up -d --build",
    ],
    options: { stdout: "inherit", stderr: "inherit" },
  })
})

Deno.test("deploy plan rejects unsafe remote paths", () => {
  for (const remotePath of ["", "/", "relative", "/srv/../root", "/srv/./app", "/srv/app name"]) {
    expect(() => createDeployPlan({ ...config, remotePath })).toThrow(DeployConfigError)
  }
})

Deno.test("deploy run propagates rsync failure and does not start SSH", async () => {
  const calls: Array<{ argv: CommandArgv; options?: RunCommandOptions }> = []
  const plan = createDeployPlan(config)

  await expect(runDeploy(plan, {
    runCommand(argv, options) {
      calls.push({ argv, options })
      return Promise.resolve(result(false, 12))
    },
    log: () => undefined,
  })).rejects.toMatchObject({ step: "rsync", code: 12, message: "rsync failed" })
  expect(calls).toEqual([plan.rsync])
})

Deno.test("deploy run propagates SSH failure after exact rsync call", async () => {
  const calls: Array<{ argv: CommandArgv; options?: RunCommandOptions }> = []
  const plan = createDeployPlan(config)

  try {
    await runDeploy(plan, {
      runCommand(argv, options) {
        calls.push({ argv, options })
        return Promise.resolve(calls.length === 1 ? result(true) : result(false, 23))
      },
      log: () => undefined,
    })
    throw new Error("Expected SSH failure")
  } catch (cause) {
    expect(cause).toBeInstanceOf(DeployStepError)
    expect(cause).toMatchObject({ step: "ssh", code: 23, message: "Remote SSH command failed" })
  }
  expect(calls).toEqual([plan.rsync, plan.ssh])
})
