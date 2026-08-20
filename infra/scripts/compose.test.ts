import { expect } from "@std/expect"
import { runCommand } from "@platform/process"

Deno.test("compose script exits 1 with user-friendly error when env file is missing", async () => {
  const root = await Deno.makeTempDir({ prefix: "compose-missing-env-" })
  const composeScript = new URL("./compose.ts", import.meta.url).pathname
  try {
    const result = await runCommand(["deno", "run", "-A", composeScript, "config"], { cwd: root })
    expect(result.success).toBe(false)
    expect(result.code).toBe(1)
    expect(result.stderr).toContain("Env file not found: ./infra/envs/.env")
  } finally {
    await Deno.remove(root, { recursive: true })
  }
})
