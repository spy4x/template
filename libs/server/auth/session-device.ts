/**
 * What a session remembers about the device that signed in (#151), worked out once at sign-in from
 * the request: a friendly name from the user agent, and the address with its last part hidden. The
 * full user agent and the full address are never stored with the session.
 *
 * Pure: no database, no environment.
 *
 * @module
 */

import { parseIp } from "@spy4x/net/ip"

/** The longest device name stored: the column's limit. */
export const DEVICE_NAME_MAX_LENGTH = 100

/** The name of a device whose user agent says nothing this module recognises. */
export const UNKNOWN_DEVICE = "Unknown device"

/** Browsers, most specific first: Edge and Opera also say "Chrome", and Chrome also says "Safari". */
const BROWSERS: readonly [RegExp, string][] = [
  [/\bEdg(e|A|iOS)?\//, "Edge"],
  [/\b(OPR|Opera)\//, "Opera"],
  [/\bSamsungBrowser\//, "Samsung Internet"],
  [/\b(Firefox|FxiOS)\//, "Firefox"],
  [/\b(Chrome|CriOS|Chromium)\//, "Chrome"],
  [/\bVersion\/[\d.]+.*\bSafari\//, "Safari"],
]

/** Systems, most specific first: Android says "Linux", and an iPad may say "Mac OS X". */
const SYSTEMS: readonly [RegExp, string][] = [
  [/\biPhone\b/, "iPhone"],
  [/\biPad\b/, "iPad"],
  [/\bAndroid\b/, "Android"],
  [/\bCrOS\b/, "ChromeOS"],
  [/\bWindows\b/, "Windows"],
  [/\bMac OS X\b|\bMacintosh\b/, "macOS"],
  [/\bLinux\b/, "Linux"],
]

/**
 * A short name a person recognises their device by, such as "Firefox on Linux" or "Safari on
 * iPhone". Only the browser or only the system is named when the other is unknown, and
 * {@link UNKNOWN_DEVICE} when neither is.
 */
export function deviceName(userAgent: string | null | undefined): string {
  const agent = userAgent ?? ""
  const browser = BROWSERS.find(([pattern]) => pattern.test(agent))?.[1]
  const system = SYSTEMS.find(([pattern]) => pattern.test(agent))?.[1]
  if (browser && system) return `${browser} on ${system}`
  return browser ?? system ?? UNKNOWN_DEVICE
}

/**
 * The address with only its network part shown: the first three parts of an IPv4 address
 * (`203.0.113.*`) or the first three groups of an IPv6 one (`2001:db8:85a3:*`). Enough to tell a
 * home from an office, too little to point at one machine. `null` when `ip` is not an address.
 */
export function ipHint(ip: string | null | undefined): string | null {
  const parsed = ip ? parseIp(ip) : null
  if (!parsed) return null
  const bytes = parsed.bytes
  if (parsed.version === 4) {
    // `parseIp` already reads an IPv4-mapped IPv6 address (`::ffff:198.51.100.7`) as IPv4.
    const [a, b, c] = bytes
    return `${a}.${b}.${c}.*`
  }
  const groups = [0, 2, 4].map((at) => ((bytes[at] << 8) | bytes[at + 1]).toString(16))
  return `${groups.join(":")}:*`
}
