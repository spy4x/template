/**
 * Puts a `localStorage` in memory in place of the runtime's for one test, and gives what it holds
 * and the way back. Deno's own is a getter on `globalThis` that a plain assignment does not
 * replace, and it keeps its values on disk from one run to the next.
 */
export function installLocalStorage(): { kept: Map<string, string>; restore(): void } {
  const kept = new Map<string, string>()
  const real = Object.getOwnPropertyDescriptor(globalThis, "localStorage")
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: (key: string) => kept.get(key) ?? null,
      setItem: (key: string, value: string) => void kept.set(key, value),
      removeItem: (key: string) => void kept.delete(key),
    },
  })
  return {
    kept,
    restore() {
      if (real) Object.defineProperty(globalThis, "localStorage", real)
      else delete (globalThis as { localStorage?: unknown }).localStorage
    },
  }
}
