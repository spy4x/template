import { basename, dirname } from "@std/path"
import { runCommand } from "@platform/process"

export async function createTestSymlink(target: string, path: string): Promise<void> {
  const cwd = dirname(path)
  const name = basename(path)
  const init = await runCommand(["git", "init", "--quiet"], {
    cwd,
    stdout: "null",
    stderr: "null",
  })
  const hash = await runCommand(["git", "hash-object", "-w", "--stdin"], {
    cwd,
    stdin: target,
    stderr: "null",
  })
  const index = hash.success
    ? await runCommand(
      ["git", "update-index", "--add", "--cacheinfo", `120000,${hash.stdout.trim()},${name}`],
      { cwd, stdout: "null", stderr: "null" },
    )
    : null
  const checkout = index?.success
    ? await runCommand(["git", "-c", "core.symlinks=true", "checkout-index", "--", name], {
      cwd,
      stdout: "null",
      stderr: "null",
    })
    : null
  if (!init.success || !hash.success || !index?.success || !checkout?.success) {
    throw new Error("Could not create test symlink")
  }
}
