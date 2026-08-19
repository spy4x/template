import { CqrsMiddleware, Query, QueryConstructor, QueryHandler, QueryResult } from "./types.ts"

export class QueryBus {
  private handlers: Map<
    QueryConstructor<Query<unknown, unknown>>,
    QueryHandler<Query<unknown, unknown>>
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

  register<T extends Query<unknown, unknown>>(
    queryClass: QueryConstructor<T>,
    handler: QueryHandler<T>,
  ): void {
    this.handlers.set(queryClass, handler as QueryHandler<Query<unknown, unknown>>)
  }

  async execute<T extends Query<unknown, unknown>>(query: T): Promise<QueryResult<T>> {
    const QueryClass = query.constructor as QueryConstructor<T>
    const handler = this.handlers.get(QueryClass)

    if (!handler) {
      throw new Error(`No handler registered for query: ${QueryClass.name}`)
    }

    return await this.run(query, () => handler(query)) as QueryResult<T>
  }

  getRegisteredQueries(): string[] {
    return Array.from(this.handlers.keys()).map((qry) => qry.name)
  }
}
