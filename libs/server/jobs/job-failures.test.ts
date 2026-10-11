import { expect } from "@std/expect"
import { describe, it } from "@std/testing/bdd"
import type { OutboxEvent } from "@spy4x/server/outbox"
import { cleanupJob, type CleanupStep, ReportingJobPublisher } from "./job-failures.ts"

const ID = "01900000-0000-7000-8000-000000000001"

/** An outbox row as the processor hands it over, on attempt `attemptCount`. */
function row(attemptCount: number, aggregateType = "job", eventKind = "mail.send"): OutboxEvent {
  return { id: ID, eventKind, aggregateType, aggregateId: ID, aggregateVersion: "1", attemptCount }
}

describe("cleanupJob", () => {
  /** Three steps that note their run; the middle one throws. */
  function steps(ran: string[]): CleanupStep[] {
    return [
      ["first", () => Promise.resolve(void ran.push("first"))],
      ["broken", () => Promise.reject(new Error("relation notes does not exist"))],
      ["last", () => Promise.resolve(void ran.push("last"))],
    ]
  }

  it("runs the steps after one that throws, logs its name and message, then fails the job", async () => {
    const ran: string[] = []
    const logged: string[] = []

    const run = cleanupJob(steps(ran), 20, (line) => logged.push(line))(row(1))

    await expect(run).rejects.toThrow(`nightly cleanup: 1 step(s) failed: "broken"`)
    expect(ran).toEqual(["first", "last"])
    expect(logged).toEqual([
      `error: nightly cleanup step "broken" failed: relation notes does not exist`,
    ])
  })

  it("ends normally on the last attempt, so the next night's run is still written", async () => {
    const ran: string[] = []
    const logged: string[] = []

    await cleanupJob(steps(ran), 20, (line) => logged.push(line))(row(20))

    expect(ran).toEqual(["first", "last"])
    expect(logged[1]).toBe(
      `error: nightly cleanup gave up on "broken" after 20 attempts; the next run is tomorrow`,
    )
  })

  it("logs nothing and ends normally when every step succeeds", async () => {
    const logged: string[] = []
    const ran: string[] = []
    const fine = steps(ran).filter(([name]) => name !== "broken")

    await cleanupJob(fine, 20, (line) => logged.push(line))(row(1))

    expect(ran).toEqual(["first", "last"])
    expect(logged).toEqual([])
  })
})

describe("ReportingJobPublisher", () => {
  /** A publisher whose one job and whose fallback both throw, logging into `logged`. */
  function publisher(logged: string[]): ReportingJobPublisher {
    return new ReportingJobPublisher({
      aggregateType: "job",
      handlers: { "mail.send": () => Promise.reject(new Error("mail not sent")) },
      fallback: { publish: () => Promise.reject(new TypeError("no channel")) },
      maxAttempts: 3,
      log: (line) => logged.push(line),
    })
  }

  it("logs a failed attempt with the job's kind and the error, and still throws", async () => {
    const logged: string[] = []

    await expect(publisher(logged).publish(row(2))).rejects.toThrow("mail not sent")

    expect(logged).toEqual([
      `warn: job mail.send (job ${ID}) failed, attempt 2 of 3: mail not sent`,
    ])
  })

  it("logs the last attempt as abandoned, naming the job's kind", async () => {
    const logged: string[] = []

    await expect(publisher(logged).publish(row(3))).rejects.toThrow("mail not sent")

    expect(logged).toEqual([
      `error: job mail.send (job ${ID}) abandoned after 3 attempts: mail not sent`,
    ])
  })

  it("logs a failing row that is not a job too", async () => {
    const logged: string[] = []

    await expect(publisher(logged).publish(row(1, "group", "group.renamed"))).rejects.toThrow(
      "no channel",
    )

    expect(logged).toEqual([
      `warn: outbox row group.renamed (group ${ID}) failed, attempt 1 of 3: no channel`,
    ])
  })

  it("logs nothing for a job that succeeds", async () => {
    const logged: string[] = []
    const quiet = new ReportingJobPublisher({
      aggregateType: "job",
      handlers: { "mail.send": () => Promise.resolve() },
      fallback: { publish: () => Promise.resolve() },
      maxAttempts: 3,
      log: (line) => logged.push(line),
    })

    await quiet.publish(row(1))

    expect(logged).toEqual([])
  })
})
