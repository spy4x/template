export type GitResult = {
  ok: boolean
  code: number
  stdout: string
  stderr: string
}

export async function runGit(args: string[], cwd?: string): Promise<GitResult> {
  const cmd = new Deno.Command("git", {
    args,
    cwd,
    stdout: "piped",
    stderr: "piped",
  })
  const output = await cmd.output()
  return {
    ok: output.code === 0,
    code: output.code,
    stdout: new TextDecoder().decode(output.stdout),
    stderr: new TextDecoder().decode(output.stderr),
  }
}
