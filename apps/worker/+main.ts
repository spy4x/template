/// <reference lib="deno.ns" />

const signals: Deno.Signal[] = ["SIGINT", "SIGTERM"]

console.log("Worker started")

await new Promise<void>((resolve) => {
  const stop = () => {
    for (const signal of signals) {
      Deno.removeSignalListener(signal, stop)
    }
    resolve()
  }

  for (const signal of signals) {
    Deno.addSignalListener(signal, stop)
  }
})

console.log("Worker stopped")
