const DEFAULT_MAX_OUTPUT_BYTES = 1024 * 1024

/** Executable followed by arguments, passed without a shell. */
export type CommandArgv = readonly [command: string, ...args: string[]]

/** Child stdin inherited from parent or disconnected. */
export type CommandInputMode = "inherit" | "null"

/** Child output inherited, discarded, or captured. */
export type CommandOutputMode = "inherit" | "null" | "piped"

/** Options controlling one command invocation. */
export interface RunCommandOptions {
  /** Child working directory. */
  cwd?: string | URL
  /** Environment entries added to, or replacing, inherited environment. */
  env?: Readonly<Record<string, string>>
  /** Remove inherited environment before applying `env`. */
  clearEnv?: boolean
  /** Child stdin mode or bytes written to piped stdin. */
  stdin?: CommandInputMode | string | Uint8Array
  /** Child stdout handling. Defaults to `piped`. */
  stdout?: CommandOutputMode
  /** Child stderr handling. Defaults to `piped`. */
  stderr?: CommandOutputMode
  /** Maximum combined captured stdout and stderr bytes. Defaults to 1 MiB. */
  maxOutputBytes?: number
}

/** Completed child status and decoded captured output. */
export interface RunCommandResult {
  /** Whether child exited successfully. */
  success: boolean
  /** Child exit code. */
  code: number
  /** Captured stdout, or empty string for non-piped stdout. */
  stdout: string
  /** Captured stderr, or empty string for non-piped stderr. */
  stderr: string
}

/** Error thrown when `runCommandOrThrow` receives a non-zero exit. */
export class CommandFailedError extends Error {
  /** Child exit code. */
  readonly code: number
  /** Executable name. Arguments remain redacted. */
  readonly command: string

  /** Creates a redacted command failure. */
  constructor(command: string, code: number) {
    super(`Command "${command}" exited with code ${code}`)
    this.name = "CommandFailedError"
    this.command = command
    this.code = code
  }
}

/** Error thrown after captured output reaches configured byte limit. */
export class CommandOutputLimitError extends Error {
  /** Executable name. Arguments remain redacted. */
  readonly command: string
  /** Configured combined output limit. */
  readonly maxOutputBytes: number

  /** Creates a redacted output-limit failure. */
  constructor(command: string, maxOutputBytes: number) {
    super(`Command "${command}" exceeded ${maxOutputBytes} captured output bytes`)
    this.name = "CommandOutputLimitError"
    this.command = command
    this.maxOutputBytes = maxOutputBytes
  }
}

class OutputBudget {
  #capturedBytes = 0

  constructor(
    private readonly command: string,
    private readonly maxOutputBytes: number,
    private readonly kill: () => void,
  ) {}

  consume(bytes: number): void {
    this.#capturedBytes += bytes
    if (this.#capturedBytes > this.maxOutputBytes) {
      this.kill()
      throw new CommandOutputLimitError(this.command, this.maxOutputBytes)
    }
  }
}

function assertMaxOutputBytes(value: number): void {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new TypeError("maxOutputBytes must be a positive safe integer")
  }
}

function bytesFromInput(input: string | Uint8Array): Uint8Array {
  return typeof input === "string" ? new TextEncoder().encode(input) : input.slice()
}

async function writeInput(stream: WritableStream<Uint8Array>, bytes: Uint8Array): Promise<void> {
  const writer = stream.getWriter()
  try {
    await writer.write(bytes)
    await writer.close()
  } catch (cause) {
    await writer.abort(cause).catch(() => undefined)
    throw cause
  }
}

async function captureOutput(
  stream: ReadableStream<Uint8Array>,
  budget: OutputBudget,
): Promise<string> {
  const chunks: Uint8Array[] = []
  let length = 0
  for await (const chunk of stream) {
    budget.consume(chunk.byteLength)
    chunks.push(chunk)
    length += chunk.byteLength
  }

  const output = new Uint8Array(length)
  let offset = 0
  for (const chunk of chunks) {
    output.set(chunk, offset)
    offset += chunk.byteLength
  }
  return new TextDecoder().decode(output)
}

/**
 * Runs argv directly without a shell and returns status plus bounded captured output.
 *
 * Arguments, environment values, and output are omitted from typed errors.
 */
export async function runCommand(
  argv: CommandArgv,
  options: RunCommandOptions = {},
): Promise<RunCommandResult> {
  const stdoutMode = options.stdout ?? "piped"
  const stderrMode = options.stderr ?? "piped"
  const maxOutputBytes = options.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES
  assertMaxOutputBytes(maxOutputBytes)

  const input = typeof options.stdin === "string" || options.stdin instanceof Uint8Array
    ? bytesFromInput(options.stdin)
    : null
  const stdinMode = input === null && options.stdin === "inherit"
    ? "inherit"
    : input === null
    ? "null"
    : "piped"
  const child = new Deno.Command(argv[0], {
    args: argv.slice(1),
    cwd: options.cwd,
    env: options.env ? { ...options.env } : undefined,
    clearEnv: options.clearEnv,
    stdin: stdinMode,
    stdout: stdoutMode,
    stderr: stderrMode,
  }).spawn()

  let killed = false
  const kill = () => {
    if (killed) return
    killed = true
    try {
      child.kill("SIGKILL")
    } catch (cause) {
      if (!(cause instanceof Deno.errors.NotFound)) throw cause
    }
  }
  const budget = new OutputBudget(argv[0], maxOutputBytes, kill)
  const statusPromise = child.status
  const stdoutPromise = stdoutMode === "piped"
    ? captureOutput(child.stdout, budget)
    : Promise.resolve("")
  const stderrPromise = stderrMode === "piped"
    ? captureOutput(child.stderr, budget)
    : Promise.resolve("")
  const inputPromise = input === null ? Promise.resolve() : writeInput(child.stdin, input)

  try {
    const [status, stdout, stderr] = await Promise.all([
      statusPromise,
      stdoutPromise,
      stderrPromise,
      inputPromise,
    ])
    return {
      success: status.success,
      code: status.code,
      stdout,
      stderr,
    }
  } catch (cause) {
    kill()
    await Promise.allSettled([statusPromise, stdoutPromise, stderrPromise, inputPromise])
    throw cause
  }
}

/** Runs argv directly and throws a redacted error for non-zero exit. */
export async function runCommandOrThrow(
  argv: CommandArgv,
  options: RunCommandOptions = {},
): Promise<RunCommandResult> {
  const result = await runCommand(argv, options)
  if (!result.success) {
    throw new CommandFailedError(argv[0], result.code)
  }
  return result
}
