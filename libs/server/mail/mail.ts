/**
 * How the template sends mail: which transport runs where, the one HTML wrapper every mail uses,
 * and the mails themselves.
 *
 * - **Development** (`ENV=dev`) uses the console sender of `@spy4x/email`: the mail goes to the
 *   worker's log, and to the `dev_mail` table, where the e2e specs read it. SMTP settings are
 *   ignored there.
 * - **Production** uses SMTP when every `SMTP_*` key is set. With any of them missing, mail is
 *   off: nothing is sent and the caller logs {@link mailOffWarning} once at start-up. The console
 *   sender never runs in production, since it prints the body, a reset link included, and
 *   container logs are shipped.
 *
 * `@spy4x/email` reads no environment by design, so the template maps its own variables here.
 *
 * @module
 */

import { createConsoleSender, type EmailSender } from "@spy4x/email/sender"
import { createSmtpSender, type SmtpOptions } from "@spy4x/email/smtp"
import { escapeHtml, htmlWrap } from "@spy4x/email/html"
import type { EmailMessage } from "@spy4x/email/message"
import type { Sql } from "@spy4x/server/db"

/** The variables SMTP needs. All five must be set for production to send mail. */
export const SMTP_KEYS = ["SMTP_HOST", "SMTP_PORT", "SMTP_USER", "SMTP_PASS", "SMTP_FROM"] as const

/** Which transport sends the mail. */
export enum MailTransport {
  /** Development: the log and the `dev_mail` table. */
  Console = 1,
  /** Production with every `SMTP_*` key set. */
  Smtp = 2,
  /** Production with an `SMTP_*` key missing: nothing is sent. */
  Off = 3,
}

/** The transport the environment picks, and what it needs. */
export type MailSetup =
  | { transport: MailTransport.Console }
  | { transport: MailTransport.Smtp; smtp: SmtpOptions }
  | { transport: MailTransport.Off; missing: string[] }

/**
 * Picks the transport from the environment. Only `ENV=dev` gets the console sender; any other
 * value is treated as production. A port that is not a whole number from 1 to 65535 counts as
 * missing. Never throws: production without SMTP must still start.
 */
export function readMailSetup(env: { get(name: string): string | undefined }): MailSetup {
  if (env.get("ENV") === "dev") return { transport: MailTransport.Console }
  const value = (key: (typeof SMTP_KEYS)[number]) => env.get(key)?.trim() ?? ""
  const port = Number(value("SMTP_PORT"))
  const missing = SMTP_KEYS.filter((key) =>
    key === "SMTP_PORT" ? !(Number.isInteger(port) && port >= 1 && port <= 65535) : !value(key)
  )
  if (missing.length > 0) return { transport: MailTransport.Off, missing }
  return {
    transport: MailTransport.Smtp,
    smtp: {
      host: value("SMTP_HOST"),
      port,
      user: value("SMTP_USER"),
      pass: value("SMTP_PASS"),
      from: value("SMTP_FROM"),
    },
  }
}

/** The start-up warning for a setup that sends nothing: it names the keys, never a value. */
export function mailOffWarning(setup: MailSetup): string | null {
  if (setup.transport !== MailTransport.Off) return null
  return `warning: mail is off, so password reset links are not sent. Set ${
    setup.missing.join(", ")
  } to send them.`
}

/**
 * The sender for `setup`, or `null` when mail is off. In development every mail is also written to
 * `dev_mail` through `sql`, before it is logged.
 */
export function createMailSender(setup: MailSetup, sql: Sql): EmailSender | null {
  if (setup.transport === MailTransport.Off) return null
  if (setup.transport === MailTransport.Smtp) return createSmtpSender(setup.smtp)
  const logged = createConsoleSender()
  return {
    async send(message) {
      const to = Array.isArray(message.to) ? message.to : [message.to]
      for (const address of to) {
        await sql`
          INSERT INTO dev_mail (to_address, subject, text_body)
          VALUES (${address}, ${message.subject}, ${message.text ?? ""})
        `
      }
      return await logged.send(message)
    },
  }
}

/** Where a mail comes from: the app's host name, which also links to the app. */
export interface MailBrand {
  /** The app's address, such as `https://app.example.com`. */
  webAppUrl: string
}

/** The one HTML wrapper every mail uses. `body` must already be escaped. */
export function mailHtml(brand: MailBrand, body: string): string {
  return htmlWrap({ body, brand: new URL(brand.webAppUrl).host, brandUrl: brand.webAppUrl })
}

/** The mail that carries a password reset link. */
export function passwordResetMail(
  brand: MailBrand,
  { to, link, validMinutes }: { to: string; link: string; validMinutes: number },
): EmailMessage {
  const host = new URL(brand.webAppUrl).host
  const asked = `Someone asked to reset the password of your account at ${host}.`
  const open = `Open this link within ${validMinutes} minutes to choose a new password.`
  const once = "The link works once, and using it signs you out everywhere."
  const ignore = "If you did not ask for this, ignore this mail: your password stays as it is."
  return {
    to,
    subject: "Reset your password",
    text: `${asked}\n\n${open}\n\n${link}\n\n${once}\n\n${ignore}\n`,
    html: mailHtml(
      brand,
      [
        `<p>${escapeHtml(asked)}</p>`,
        `<p>${escapeHtml(open)}</p>`,
        `<p><a href="${escapeHtml(link)}">Choose a new password</a></p>`,
        `<p>${escapeHtml(once)}</p>`,
        `<p>${escapeHtml(ignore)}</p>`,
      ].join("\n"),
    ),
  }
}
