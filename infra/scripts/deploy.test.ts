/// <reference lib="deno.ns" />
import { expect } from "@std/expect"
import { planDeploy, shellQuote } from "./deploy.ts"
import { MissingEnvVarError } from "./env-file.ts"

const ENV_FILE = "infra/envs/.env.home"

Deno.test("planDeploy sends files and the env file to the host and path from the env file", () => {
  const [files, envFile] = planDeploy(
    { SSH_TO_SERVER: "deploy@home.example.net", PATH_ON_SERVER: "/srv/app" },
    ENV_FILE,
  )
  expect(files.command).toBe("rsync")
  expect(files.args.at(-1)).toBe("deploy@home.example.net:/srv/app")
  expect(envFile.command).toBe("rsync")
  expect(envFile.args.slice(-2)).toEqual([
    ENV_FILE,
    "deploy@home.example.net:/srv/app/infra/envs/.env",
  ])
})

Deno.test("planDeploy leaves local env files out of the file copy", () => {
  const [files] = planDeploy({ SSH_TO_SERVER: "h", PATH_ON_SERVER: "/srv/app" }, ENV_FILE)
  const exclude = files.args.indexOf("--exclude=/infra/envs/.env*")
  const include = files.args.indexOf("--include-from=infra/deploy/include.txt")
  expect(exclude).toBeGreaterThan(-1)
  expect(exclude).toBeLessThan(include)
})

Deno.test("planDeploy starts the app in the quoted path with the configured Deno", () => {
  const [, , start] = planDeploy(
    { SSH_TO_SERVER: "h", PATH_ON_SERVER: "/srv/my app", DENO_ON_SERVER: "/opt/deno/deno" },
    ENV_FILE,
  )
  expect(start).toEqual({
    label: "Starting the app",
    command: "ssh",
    args: [
      "h",
      `cd '/srv/my app' && PATH="$HOME/.deno/bin:$PATH" /opt/deno/deno task compose up -d --build`,
    ],
  })
})

Deno.test("planDeploy reads a leading ~/ in PATH_ON_SERVER as the home directory", () => {
  const [files, , start] = planDeploy({ SSH_TO_SERVER: "h", PATH_ON_SERVER: "~/app" }, ENV_FILE)
  expect(files.args.at(-1)).toBe("h:app")
  expect(start.args[1]).toMatch(/^cd 'app' && .* deno task compose up -d --build$/)
})

Deno.test("planDeploy refuses an env file without SSH_TO_SERVER or PATH_ON_SERVER", () => {
  expect(() => planDeploy({ PATH_ON_SERVER: "/srv/app" }, ENV_FILE))
    .toThrow(new MissingEnvVarError("SSH_TO_SERVER", ENV_FILE))
  expect(() => planDeploy({ SSH_TO_SERVER: "h" }, ENV_FILE))
    .toThrow(new MissingEnvVarError("PATH_ON_SERVER", ENV_FILE))
})

Deno.test("shellQuote keeps a single quote inside one shell word", () => {
  expect(shellQuote(`it's`)).toBe(`'it'\\''s'`)
})
