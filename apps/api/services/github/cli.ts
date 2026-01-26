import { config } from "@api/services/config.ts"

export type GhCliResult = {
  ok: boolean
  code: number
  stdout: string
  stderr: string
}

export async function runGh(args: string[], input?: string): Promise<GhCliResult> {
  if (!config.github.ghCliEnabled) {
    return { ok: false, code: 1, stdout: "", stderr: "gh cli disabled" }
  }
  if (config.github.ghCliDryRun) {
    return { ok: true, code: 0, stdout: "dry-run", stderr: "" }
  }
  const cmd = new Deno.Command("gh", {
    args,
    stdin: input ? "piped" : "null",
    stdout: "piped",
    stderr: "piped",
  })
  const child = cmd.spawn()
  if (input) {
    const writer = child.stdin.getWriter()
    await writer.write(new TextEncoder().encode(input))
    await writer.close()
  }
  const output = await child.output()
  return {
    ok: output.code === 0,
    code: output.code,
    stdout: new TextDecoder().decode(output.stdout),
    stderr: new TextDecoder().decode(output.stderr),
  }
}
