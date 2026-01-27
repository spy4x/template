import { Event, EventConstructor } from "./types.ts"

export class EventBus {
  private listeners: Map<
    EventConstructor<Event<unknown>>,
    Array<(event: Event<unknown>) => void>
  > = new Map()

  on<T extends Event<unknown>>(
    eventClass: EventConstructor<T>,
    callback: (event: T) => void,
  ): () => void {
    if (!this.listeners.get(eventClass)) {
      this.listeners.set(eventClass, [])
    }
    this.listeners.get(eventClass)!.push(callback as (event: Event<unknown>) => void)
    return () => {
      const callbacks = this.listeners.get(eventClass) || []
      this.listeners.set(eventClass, callbacks.filter((cb) => cb !== callback))
    }
  }

  once<T extends Event<unknown>>(
    eventClass: EventConstructor<T>,
    callback: (event: T) => void,
  ): () => void {
    const unsubscribe = this.on(eventClass, (event) => {
      callback(event)
      unsubscribe()
    })
    return unsubscribe
  }

  emit<T extends Event<unknown>>(event: T): void {
    queueMicrotask(() => {
      const eventClass = event.constructor as EventConstructor<T>
      const callbacks = this.listeners.get(eventClass)
      if (callbacks) {
        for (const callback of callbacks) {
          callback(event as Event<unknown>)
        }
      }
    })
  }
}
