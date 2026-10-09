import { expect } from "@std/expect"
import { describe, it } from "@std/testing/bdd"
import { startRunnerWhileCurrent } from "./start-runner.ts"

function fakeRunner() {
  const calls: string[] = []
  return { calls, start: () => calls.push(`start`) }
}

describe(`startRunnerWhileCurrent`, () => {
  it(`starts the runner once the queue is loaded and its layer is still running`, async () => {
    const runner = fakeRunner()
    await startRunnerWhileCurrent(runner, Promise.resolve(), () => true)
    expect(runner.calls).toEqual([`start`])
  })

  it(`does not start a runner whose layer was stopped while the queue was loading`, async () => {
    const runner = fakeRunner()
    let current = true
    let loaded!: () => void
    const started = startRunnerWhileCurrent(
      runner,
      new Promise<void>((resolve) => loaded = resolve),
      () => current,
    )
    current = false
    loaded()
    await started
    expect(runner.calls).toEqual([])
  })
})
