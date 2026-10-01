import { expect } from "@std/expect"
import { describe, it } from "@std/testing/bdd"
import type { Sql } from "@spy4x/server/db"
import {
  createMailSender,
  mailOffWarning,
  MailTransport,
  passwordResetMail,
  readMailSetup,
  SMTP_KEYS,
} from "./mail.ts"

const env = (values: Record<string, string>) => ({ get: (name: string) => values[name] })

const SMTP = {
  SMTP_HOST: "smtp.example.com",
  SMTP_PORT: "587",
  SMTP_USER: "mailer",
  SMTP_PASS: "not-a-real-password",
  SMTP_FROM: "App <noreply@example.com>",
}

describe("readMailSetup", () => {
  it("uses the console in development, even with SMTP set", () => {
    expect(readMailSetup(env({ ENV: "dev", ...SMTP }))).toEqual({
      transport: MailTransport.Console,
    })
  })

  it("uses SMTP in production when every SMTP key is set", () => {
    expect(readMailSetup(env({ ENV: "prod", ...SMTP }))).toEqual({
      transport: MailTransport.Smtp,
      smtp: {
        host: "smtp.example.com",
        port: 587,
        user: "mailer",
        pass: "not-a-real-password",
        from: "App <noreply@example.com>",
      },
    })
  })

  it("turns mail off in production without SMTP, never falling back to the console", () => {
    for (const ENV of ["prod", "staging", ""]) {
      expect(readMailSetup(env({ ENV }))).toEqual({
        transport: MailTransport.Off,
        missing: [...SMTP_KEYS],
      })
    }
  })

  it("names only the missing keys, and counts a port that is not one as missing", () => {
    const setup = readMailSetup(env({ ENV: "prod", ...SMTP, SMTP_PORT: "smtp", SMTP_PASS: " " }))

    expect(setup).toEqual({ transport: MailTransport.Off, missing: ["SMTP_PORT", "SMTP_PASS"] })
  })
})

describe("mailOffWarning", () => {
  it("names the missing keys and carries none of the values that are set", () => {
    const setup = readMailSetup(env({ ENV: "prod", SMTP_PASS: "not-a-real-password" }))

    const warning = mailOffWarning(setup)!

    for (const key of ["SMTP_HOST", "SMTP_PORT", "SMTP_USER", "SMTP_FROM"]) {
      expect(warning).toContain(key)
    }
    expect(warning).not.toContain("not-a-real-password")
  })

  it("says nothing when mail is sent", () => {
    expect(mailOffWarning(readMailSetup(env({ ENV: "prod", ...SMTP })))).toBe(null)
    expect(mailOffWarning(readMailSetup(env({ ENV: "dev" })))).toBe(null)
  })
})

/** A stand-in for the Postgres client that records every statement's values. */
function recordingSql(): { sql: Sql; rows: unknown[][] } {
  const rows: unknown[][] = []
  const sql = ((_strings: TemplateStringsArray, ...values: unknown[]) => {
    rows.push(values)
    return Promise.resolve([])
  }) as unknown as Sql
  return { sql, rows }
}

describe("createMailSender", () => {
  it("sends nothing when mail is off", () => {
    const { sql } = recordingSql()

    expect(createMailSender({ transport: MailTransport.Off, missing: ["SMTP_HOST"] }, sql)).toBe(
      null,
    )
  })

  it("keeps a copy of each development mail in dev_mail for the e2e specs", async () => {
    const { sql, rows } = recordingSql()
    const sender = createMailSender({ transport: MailTransport.Console }, sql)!

    const result = await sender.send({ to: "ann@example.com", subject: "Hi", text: "Hello" })

    expect(result.ok).toBe(true)
    expect(rows).toEqual([["ann@example.com", "Hi", "Hello"]])
  })
})

describe("passwordResetMail", () => {
  const link = "https://app.example.com/reset-password?email=ann%40example.com&code=abc"
  const mail = passwordResetMail(
    { webAppUrl: "https://app.example.com" },
    { to: "ann@example.com", link, validMinutes: 30 },
  )

  it("carries the link and how long it works in the text and the HTML", () => {
    expect(mail.to).toBe("ann@example.com")
    expect(mail.subject).toBe("Reset your password")
    expect(mail.text).toContain(link)
    expect(mail.text).toContain("30 minutes")
    expect(mail.html).toContain(`href="${link.replace("&", "&amp;")}"`)
  })

  it("wraps the HTML in the shared shell, branded with the app's host", () => {
    expect(mail.html).toMatch(/^<!doctype html>/)
    expect(mail.html).toContain(">app.example.com</a>")
  })
})
