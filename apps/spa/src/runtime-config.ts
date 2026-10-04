import { type } from "arktype"

/**
 * What the SPA reads from `/config.json` before it renders. The container writes the file at
 * start-up from `apps/spa/public-env.allow`, so one built image serves any environment. Every key
 * is optional: a missing one means "the default".
 */
const RuntimeConfigSchema = type({
  "env?": "string",
  "errorReportDsn?": "string",
})

export type RuntimeConfig = typeof RuntimeConfigSchema.infer

/** Used when the file is missing or invalid: no error tracker, no environment label. */
export const DEFAULT_RUNTIME_CONFIG: RuntimeConfig = {}

/**
 * Fetches and validates `/config.json`. The request skips the browser's HTTP cache: the file
 * changes with the container, and the service worker keeps the copy that serves an offline start.
 * A missing, unreachable or invalid file gives the defaults (and a console warning) rather than a
 * blank page; unknown keys are dropped.
 */
export async function loadRuntimeConfig(
  fetcher: typeof fetch = fetch,
  url = `/config.json`,
): Promise<RuntimeConfig> {
  try {
    const response = await fetcher(url, { cache: `no-store` })
    if (!response.ok) throw new Error(`status ${response.status}`)
    const parsed = RuntimeConfigSchema(await response.json())
    if (parsed instanceof type.errors) throw new Error(parsed.summary)
    return {
      ...(parsed.env === undefined ? {} : { env: parsed.env }),
      ...(parsed.errorReportDsn === undefined ? {} : { errorReportDsn: parsed.errorReportDsn }),
    }
  } catch (error) {
    console.warn(`Runtime config ignored, using defaults:`, error)
    return DEFAULT_RUNTIME_CONFIG
  }
}
