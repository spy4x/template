import { config } from "@api/services/config.ts"

export type OpencodeResult = {
  ok: boolean
  code: number
  stdout: string
  stderr: string
}

export async function runOpencode(
  args: string[],
  cwd: string,
  env: Record<string, string>,
): Promise<OpencodeResult> {
  const cmd = new Deno.Command(config.github.opencodeCmd, {
    args: [...config.github.opencodeArgs, ...args],
    cwd,
    env,
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
