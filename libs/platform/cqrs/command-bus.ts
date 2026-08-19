import {
  Command,
  CommandConstructor,
  CommandHandler,
  CommandResult,
  CqrsMiddleware,
} from "./types.ts"

export class CommandBus {
  private handlers: Map<
    CommandConstructor<Command<unknown, unknown>>,
    CommandHandler<Command<unknown, unknown>>
  > = new Map()

  private middlewares: CqrsMiddleware[] = []

  /** Middlewares run in registration order, outermost first. */
  use(middleware: CqrsMiddleware): void {
    this.middlewares.push(middleware)
  }

  private run(message: { data: unknown }, handler: () => Promise<unknown>): Promise<unknown> {
    let lastCalled = -1
    const step = (index: number): Promise<unknown> => {
      if (index <= lastCalled) {
        return Promise.reject(new Error("CQRS middleware called next() more than once"))
      }
      lastCalled = index
      const middleware = this.middlewares[index]
      if (!middleware) return handler()
      return middleware(message, () => step(index + 1))
    }
    return step(0)
  }

  register<T extends Command<unknown, unknown>>(
    commandClass: CommandConstructor<T>,
    handler: CommandHandler<T>,
  ): void {
    this.handlers.set(commandClass, handler as CommandHandler<Command<unknown, unknown>>)
  }

  async execute<T extends Command<unknown, unknown>>(command: T): Promise<CommandResult<T>> {
    const CommandClass = command.constructor as CommandConstructor<T>
    const handler = this.handlers.get(CommandClass)

    if (!handler) {
      throw new Error(`No handler registered for command: ${CommandClass.name}`)
    }

    return await this.run(command, () => handler(command)) as CommandResult<T>
  }

  getRegisteredCommands(): string[] {
    return Array.from(this.handlers.keys()).map((cmd) => cmd.name)
  }
}
