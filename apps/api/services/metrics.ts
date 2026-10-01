/**
 * The API's one metrics mechanism: named counters held in memory. Nothing exports them yet; the
 * scrape endpoint and the alert rule that reads them are spy4x/template#159.
 */
const counters = new Map<string, Map<string, number>>()

/** Adds one to the counter `name` for this exact set of labels. */
export function incrementCounter(name: string, labels: Readonly<Record<string, string>>): void {
  const series = counters.get(name) ?? new Map<string, number>()
  counters.set(name, series)
  const key = JSON.stringify(Object.entries(labels).sort(([a], [b]) => a.localeCompare(b)))
  series.set(key, (series.get(key) ?? 0) + 1)
}

/** The counter's value for this exact set of labels; 0 when it was never incremented. */
export function counterValue(name: string, labels: Readonly<Record<string, string>>): number {
  const key = JSON.stringify(Object.entries(labels).sort(([a], [b]) => a.localeCompare(b)))
  return counters.get(name)?.get(key) ?? 0
}
