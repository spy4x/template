import { createContext, type JSX } from "preact"
import { useContext } from "preact/hooks"
import {
  createFormatters,
  type CreateFormattersOptions,
  type DateInput,
  type FormatSettings,
  type Formatters,
} from "@spy4x/time/format"
import { timeAgo } from "@spy4x/platform/universal/time"

/**
 * The one formatter of every date and time the SPA and the admin app show (#163). It reads
 * the person's own region format, time zone and clock, so a date looks the same on every screen and
 * every device. `tests/no-direct-date-format.test.ts` fails on a direct `toLocale*String()` or
 * `new Intl.DateTimeFormat` anywhere else in the apps and in `libs/ui`.
 *
 * The words around a date stay English ("5 minutes ago"): the region format changes how dates and
 * times are written, never the language of the app. Numbers are not covered yet: the admin charts
 * write them with `Intl.NumberFormat` on their own.
 *
 * @module
 */

/** The formatters of one person's settings, with the few shapes the screens need beside them. */
export interface AppFormat extends Formatters {
  /** A day without its year, `17 Oct` or `Oct 17`: a chart's axis. */
  dayMonth(value: DateInput): string
  /**
   * The exact instant in UTC, to the second, with the zone named: `17 Oct 2026, 14:05:09 UTC`. For
   * the audit log, whose rows an operator matches against the server's logs, which are in UTC.
   */
  exactUtc(value: DateInput): string
  /**
   * The same region format and clock in UTC: a day the server counted in UTC (a chart's bucket)
   * keeps its own date wherever the reader is.
   */
  utc(): AppFormat
}

/**
 * Build the formatter for a person's settings. `null` or a missing setting is "automatic": this
 * device's own. A tag or zone the runtime does not know falls back to the device's.
 */
export function appFormat(
  settings: FormatSettings = {},
  options: CreateFormattersOptions = {},
): AppFormat {
  const base = createFormatters(settings, options)
  const clock = base.hourCycle ? { hourCycle: base.hourCycle } : {}
  let dayMonthFormat: Intl.DateTimeFormat | undefined
  let exactFormat: Intl.DateTimeFormat | undefined
  return {
    ...base,
    dayMonth(value) {
      const instant = toDate(value)
      if (!instant) return `-`
      dayMonthFormat ??= new Intl.DateTimeFormat(base.locale, {
        day: `numeric`,
        month: `short`,
        timeZone: base.timeZone,
      })
      return dayMonthFormat.format(instant)
    },
    exactUtc(value) {
      const instant = toDate(value)
      if (!instant) return `-`
      exactFormat ??= new Intl.DateTimeFormat(base.locale, {
        year: `numeric`,
        month: `short`,
        day: `numeric`,
        hour: `2-digit`,
        minute: `2-digit`,
        second: `2-digit`,
        timeZone: `UTC`,
        timeZoneName: `short`,
        ...clock,
      })
      return exactFormat.format(instant)
    },
    utc() {
      return appFormat(
        { locale: base.locale, timeZone: `UTC`, hourCycle: base.hourCycle },
        options,
      )
    },
  }
}

function toDate(value: DateInput): Date | null {
  if (value === null || value === undefined || value === ``) return null
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date
}

/**
 * The formatter the screens read. An app provides the person's own with
 * `<FormatContext.Provider value={…}>` around everything; without one (a test, a page before
 * sign-in) it is this device's region format and zone.
 */
export const FormatContext = createContext<AppFormat>(appFormat())

/** The formatter of the person whose screen this is. */
export function useFormat(): AppFormat {
  return useContext(FormatContext)
}

/**
 * A moment as "3 days ago", with the exact date and time in the person's format on hover and for a
 * machine.
 */
export function When({ at, class: className }: { at: string; class?: string }): JSX.Element {
  const format = useFormat()
  return <time class={className} dateTime={at} title={format.dateTime(at)}>{timeAgo(at)}</time>
}

/** A calendar day in the person's format, with the exact date and time on hover. */
export function OnDay({ at, class: className }: { at: string; class?: string }): JSX.Element {
  const format = useFormat()
  return <time class={className} dateTime={at} title={format.dateTime(at)}>{format.date(at)}</time>
}

/** The clock a region format uses on its own: `h12` (`3:45 PM`) or `h23` (`15:45`). */
export function regionHourCycle(locale: string): "h12" | "h23" {
  const cycle = new Intl.DateTimeFormat(locale, { hour: `numeric` }).resolvedOptions().hourCycle
  return cycle === `h11` || cycle === `h12` ? `h12` : `h23`
}
