import { expect } from "@std/expect"
import { describe, it } from "@std/testing/bdd"
import type { OutboxEvent } from "@spy4x/server/outbox"
import { JOB_AGGREGATE, JobPublisher, nextUtcHour, OUTBOX_CLEANUP_JOB } from "./jobs.ts"

const event = (aggregateType: string, eventKind: string): OutboxEvent => ({
  id: crypto.randomUUID(),
  eventKind,
  aggregateType,
  aggregateId: crypto.randomUUID(),
  aggregateVersion: "1",
  attemptCount: 1,
})

describe("JobPublisher", () => {
  it("runs the handler of a job and leaves the fallback alone", async () => {
    const calls: string[] = []
    const publisher = new JobPublisher(
      { [OUTBOX_CLEANUP_JOB]: () => Promise.resolve(void calls.push("job")) },
      { publish: () => Promise.resolve(void calls.push("fallback")) },
    )

    await publisher.publish(event(JOB_AGGREGATE, OUTBOX_CLEANUP_JOB))

    expect(calls).toEqual(["job"])
  })

  it("passes a row that is not a job to the fallback", async () => {
    const calls: string[] = []
    const publisher = new JobPublisher(
      { [OUTBOX_CLEANUP_JOB]: () => Promise.resolve(void calls.push("job")) },
      { publish: () => Promise.resolve(void calls.push("fallback")) },
    )

    await publisher.publish(event("group", "group.created"))

    expect(calls).toEqual(["fallback"])
  })

  it("fails a job nobody handles, so it is retried and then stops with its error", async () => {
    const publisher = new JobPublisher({}, { publish: () => Promise.resolve() })

    await expect(publisher.publish(event(JOB_AGGREGATE, "mystery"))).rejects.toThrow(
      "no handler for job mystery",
    )
  })
})

describe("nextUtcHour", () => {
  it("picks later today when the hour has not come yet", () => {
    expect(nextUtcHour(new Date("2026-10-03T01:00:00Z"), 3).toISOString()).toBe(
      "2026-10-03T03:00:00.000Z",
    )
  })

  it("picks tomorrow when the hour is now or past", () => {
    expect(nextUtcHour(new Date("2026-10-03T03:00:00Z"), 3).toISOString()).toBe(
      "2026-10-04T03:00:00.000Z",
    )
    expect(nextUtcHour(new Date("2026-10-31T23:59:00Z"), 3).toISOString()).toBe(
      "2026-11-01T03:00:00.000Z",
    )
  })
})
