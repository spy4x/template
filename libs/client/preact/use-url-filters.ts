import { batch, type Signal, useSignal, useSignalEffect } from "@preact/signals"
import { useEffect, useRef } from "preact/hooks"
import { useSearchParams } from "wouter-preact"

/**
 * Two-way binding between URL parameters and filter signals.
 *
 * The code is a copy of `@preact-components/signals/use-url-filters` from
 * spy4x/preact-components; only its comments are adapted. It stays here until that package is
 * published and this file can be replaced by an import
 * (https://github.com/spy4x/template/issues/41). Change it there, not here.
 *
 * The version this replaces registered its `popstate` listener inside the wrong effect, so the
 * handler was never attached and browser back and forward left the filters stale. There is no
 * listener now: the router already re-renders this hook on `popstate`, `pushState`,
 * `replaceState` and `hashchange`, and the URL-to-signals effect below is keyed on the search
 * string it hands over, so every one of those arrives by the same path. `e2e/url-filters.e2e.ts`
 * proves back and forward in a real browser. The pure helpers below are unit-tested in
 * spy4x/preact-components (`signals/use-url-filters.test.ts`), which is where the references to
 * `use-url-filters.test.ts` point.
 */

/** One filter, bound to one URL parameter. */
export interface FilterField<T = string | number | null> {
  /** The signal the UI reads and writes. */
  signal: Signal<T>
  /** Name of the query parameter this field round-trips through. */
  urlParam: string
  /** Value that means "no filter"; cleared from the URL rather than written to it. */
  initialValue: T
  /** Custom URL-to-value coercion. Defaults to `parseInt` for numbers, identity otherwise. */
  parser?: (value: string | null) => T
}

/** Result of {@link useUrlFilters}. */
export interface UrlFilters<T extends Record<string, FilterField>> {
  /** The signals, keyed as they were passed in. */
  filters: { [K in keyof T]: T[K]["signal"] }
  /** True while the URL is being read into the signals, before they may write back. */
  isInitializing: Signal<boolean>
  /** Reset every filter to its default, which also clears it from the URL. */
  clearFilters: () => void
}

/**
 * Value a URL parameter implies for one field.
 *
 * A missing parameter means the default. A number field parses with `parseInt`, falling back to the
 * default rather than to `NaN` when the parameter is junk — which is what the template version did
 * with `isNaN`, kept here because a `?page=abc` URL is a real thing users end up with.
 */
export function resolveFilterValue<T>(field: FilterField<T>, raw: string | null): T {
  if (raw === null) return field.initialValue
  if (field.parser) return field.parser(raw)
  if (typeof field.initialValue === "number") {
    const parsed = Number.parseInt(raw, 10)
    // Both branches narrow a generic `T` from a value whose runtime type the check above establishes;
    // TypeScript cannot carry that check back to `T`.
    return (Number.isNaN(parsed) ? field.initialValue : parsed) as T
  }
  return (raw || field.initialValue) as T
}

/** Whether a value belongs in the URL: not the default, not `null`, not the empty string. */
export function shouldPersistFilter<T>(field: FilterField<T>, value: T): boolean {
  return value !== field.initialValue && value !== null && value !== ""
}

/** What one filter does to its own query parameter: set it, or — with no `value` — remove it. */
export interface FilterWrite {
  /** Name of the query parameter. */
  urlParam: string
  /** What to write, or `undefined` to take the parameter out of the query string. */
  value?: string
}

/**
 * What one field's value means for its parameter.
 *
 * @param field The field.
 * @param value Its current value.
 * @returns The parameter written, or removed when the value is one {@link shouldPersistFilter}
 *          keeps out of the address.
 */
export function filterWrite<T>(field: FilterField<T>, value: T): FilterWrite {
  return {
    urlParam: field.urlParam,
    value: shouldPersistFilter(field, value) ? String(value) : undefined,
  }
}

/**
 * Take every field back to its default, as **one** change.
 *
 * The `batch` is the point. Preact's signals adapter already batches writes made inside an event
 * handler, so a clear driven by a button behaves this way with or without it — measured on the
 * preact-components Pages demo: one `pushState` either way. An application that clears from a
 * timer, or after a request comes back, is outside that adapter's reach, and there each field
 * would be a change of its own: a write per field, a history entry per field, and a reader who
 * has to press Back once per filter to undo one clear. `use-url-filters.test.ts` is where that is
 * held.
 *
 * @param fields The fields to reset.
 */
export function clearFilterFields<T extends Record<string, FilterField>>(fields: T): void {
  batch(() => {
    for (const field of Object.values(fields)) {
      field.signal.value = field.initialValue
    }
  })
}

/**
 * The query string a set of filter values implies, starting from the one the address already has.
 *
 * Three rules live here, and they are the whole of what a write does **to the query string** —
 * which is why this is a function over two strings rather than something only a browser can run.
 * What the write then does to the rest of the address is {@link restoredAddress}.
 *
 * - A parameter the caller says nothing about is **carried through untouched**. An application's
 *   address holds more than one component's filters — a tab, a sort, a campaign tag — and a write
 *   that rebuilt the query string from nothing would delete other people's state. A repeated key
 *   (`?tag=a&tag=b`) survives the same way, as long as no filter owns that name.
 * - A filter holding its default is **removed**, so an unfiltered list has a clean address.
 * - Everything else is **set**.
 *
 * One cosmetic cost of rebuilding through `URLSearchParams`: a carried parameter comes back in that
 * class's own spelling, so `q=x%20y` reads as `q=x+y` after the first write. Both decode to the
 * same thing, and a read alone never rewrites anything, so nothing is lost but the spelling.
 *
 * @param search The query string to start from, with or without its leading `?`.
 * @param writes What each filter does to its own parameter.
 * @returns The query string, with no leading `?`.
 */
export function filterSearch(search: string, writes: readonly FilterWrite[]): string {
  const next = new URLSearchParams(search)
  for (const { urlParam, value } of writes) {
    if (value === undefined) next.delete(urlParam)
    else next.set(urlParam, value)
  }

  return next.toString()
}

/** An address as `location` reports it, in the four pieces this hook has to read. */
export interface AddressParts {
  /** `location.pathname`: the path, including whatever base path the site is served under. */
  pathname: string
  /** `location.search`: the query string with its leading `?`, or empty. */
  search: string
  /** `location.hash`: the fragment with its leading `#`, or empty. */
  hash: string
  /**
   * `location.href`: the whole address. It is here for one distinction the other three cannot
   * make. An address ending in a bare `?` — which is what the router leaves behind when a write
   * empties the query string, because it navigates to `pathname + "?" + ""` — reports `search` as
   * the empty string, exactly like an address with no query string at all.
   */
  href: string
}

/**
 * The address the write should have left behind, or `undefined` when that is already the address.
 *
 * Two things are wrong with the address the router leaves, and both are things it appends or drops
 * that no filter asked it to.
 *
 * **The fragment.** The router's `navigate` is handed `pathname?search` and nothing else, and a
 * target with no `#` resolves to an address with no fragment — measured in Chromium:
 * `history.pushState(null, "", "/x?y=1")` on `/x#anchor` leaves `location.hash` empty. So the write
 * is followed by a question this function answers: did the address just lose a fragment it had a
 * moment ago, and what is the address that has it again?
 *
 * **The bare `?`.** A write that empties the query string — clearing the last filter — navigates to
 * `pathname + "?" + ""`, and the address keeps that question mark with nothing after it. Left
 * alone, an address with a fragment and one without would end a clear differently (`/list#section`
 * against `/list?`), for no reason a reader could see, so the same step takes it off.
 *
 * The condition is a **measurement of the address**, not a guess about which location hook the
 * router is using, and that is the point of doing it after the write rather than before. A router
 * that keeps its own location in the fragment — wouter's `useHashLocation` — sets the fragment as
 * part of navigating, so `after.hash` is not empty and this function answers `undefined`, leaving
 * that router's own write alone. Handing the fragment to `navigate` instead would have corrupted
 * exactly that case: `useHashLocation`'s navigate splits its target on `?`, so the fragment lands
 * percent-encoded inside the query string (`?page=2%23/list`). No browser check in either
 * repository exercises that guard, because each demo runs one router: proving it would take a
 * second router on the page whose own navigation sets a different fragment.
 * `use-url-filters.test.ts` holds it at the level this function works at, which is the address
 * rather than the router.
 *
 * Everything is rebuilt from the address the write left behind, so a base path needs no special
 * handling: it is already in `after.pathname`, whether it came from the site's own prefix or from a
 * router `base`. The fragment is copied across verbatim, which is what a fragment carrying its own
 * `?`, `&` or `=` — a hash route such as `#/list?tab=2` — needs.
 *
 * @param fragment The fragment as it was immediately before the write, `#` included, or empty.
 * @param after The address the write left behind.
 * @returns The address to replace the current history entry with, or `undefined` for no change.
 */
export function restoredAddress(fragment: string, after: AddressParts): string | undefined {
  // Documented insurance rather than a proven branch: no browser check reaches this line, and
  // making one would take a second router on a demo page that sets a different fragment while
  // navigating. What holds it is `use-url-filters.test.ts`, over the address alone.
  if (after.hash !== "") return undefined
  if (fragment === "" && !after.href.endsWith("?")) return undefined
  return `${after.pathname}${after.search}${fragment}`
}

/**
 * Bind filter signals to URL parameters.
 *
 * Call it with fields built from `useSignal`, so the signals outlive the component and a sibling
 * can read the active filters:
 *
 * ```tsx
 * const status = useSignal("")
 * const page = useSignal(1)
 * const { filters, clearFilters } = useUrlFilters({
 *   status: { signal: status, urlParam: "status", initialValue: "" },
 *   page: { signal: page, urlParam: "page", initialValue: 1 },
 * })
 * ```
 *
 * The binding runs both ways for as long as the component is mounted. Any change to the address the
 * router reports — a link, a push, back, forward — re-reads every parameter into its signal, and a
 * parameter that has left the address takes its field back to `initialValue`. A filter changing in
 * the page writes the whole set back through the router; a parameter belonging to anything else on
 * the page is carried through that write untouched (see {@link filterSearch}).
 *
 * **Reading the address never writes to it.** A filter changing in the page is the only thing that
 * does. That matters most for an address this hook would spell differently — a filter written out
 * at its default (`?page=1`), a value a `parser` rejects (`?size=huge`), an empty value
 * (`?status=`) — which is left exactly as it arrived rather than tidied up. The filters follow it,
 * the address bar keeps the redundant parameter, and the first real filter change rewrites the
 * query string canonically.
 *
 * The alternative, rewriting on arrival, is what this hook used to do, and it cost two things a
 * reader notices: a deep link to `?page=1` gained a history entry nobody asked for, so pressing
 * Back landed on the address the hook had just rewritten and was rewritten again — Back went
 * nowhere — and on a fragment-routed page the rewrite took the route with it.
 *
 * **A write changes the query string and nothing else.** The path, a parameter belonging to
 * something else on the page (see {@link filterSearch}) and the fragment all come through it
 * untouched, so a page keeping a hash route or an anchor in the fragment keeps it when a filter
 * changes. The router's `navigate` pushes `pathname?search` and carries no fragment of its own, so
 * the write puts one back when the address had one; {@link restoredAddress} is that step, and its
 * documentation says why it runs after the router rather than instead of it.
 *
 * **The one case where the fragment is still lost: a router that defers its navigation.** The step
 * that puts the fragment back runs immediately after the router's write, so it depends on that
 * write having already happened. A `<Router>` given an `aroundNav` that defers — wouter's own
 * option, and what a view transition is configured with — navigates later, after this step has
 * looked at an address nothing has changed yet and found nothing to do. What a reader sees is the
 * original defect: the fragment disappears from the address bar when a filter changes, silently.
 * No check in this repository covers it, because nothing here configures `aroundNav`.
 *
 * **One address change costs one history entry**, whichever direction it came from, so one press of
 * Back moves the reader once. `clearFilters` is one change, not one per field.
 */
export function useUrlFilters<T extends Record<string, FilterField>>(fields: T): UrlFilters<T> {
  const [searchParams, setSearchParams] = useSearchParams()
  const isInitializing = useSignal(true)

  // URL → signals, re-read whenever the router's search string changes.
  //
  // A plain effect keyed on that string, and not `useSignalEffect`: in the pinned
  // `@preact/signals` 2.5.1 `useSignalEffect` is `useEffect(…, [])` whose body re-runs only when a
  // signal it *read* changes, and this body reads none. So the filters used to be read out of the
  // address once, at mount, and a route pushed afterwards left them showing the previous route's
  // values while the address bar showed the new one.
  //
  // `searchParams` is the router's own `useMemo(() => new URLSearchParams(search), [search])`, so
  // its `toString()` moves exactly when the router's search string does. Two spellings of the same
  // parameters — `?q=a%20b` and `?q=a+b` — normalise to one string and do not re-run the effect,
  // which is correct: they resolve to the same filter values.
  const search = searchParams.toString()

  // Two strings the effects below need and a render is the only place to catch.
  //
  // `latestSearch` is the address as the router last reported it: what a write starts from, so that
  // a parameter this hook does not own is carried across it. The callback form of `setSearchParams`
  // would hand the same thing over, but only once the decision to navigate has already been taken.
  //
  // `agreed` is the query string the filters implied the last time they read the address — the
  // canonical spelling of what they now hold. The write compares against *that* rather than against
  // the address, which is what makes reading harmless: an address spelt differently from the way
  // the filters would spell it (`?page=1`, `?size=huge`) produces no write, while a filter that
  // actually changes always produces one, including the change `clearFilters` makes.
  //
  // Both are also assigned by the write itself, so two writes in one tick each start from what the
  // one before them left.
  const latestSearch = useRef(search)
  latestSearch.current = search
  const agreed = useRef(search)

  useEffect(() => {
    isInitializing.value = true
    for (const field of Object.values(fields)) {
      field.signal.value = resolveFilterValue(field, searchParams.get(field.urlParam))
    }
    agreed.current = filterSearch(
      search,
      Object.values(fields).map((field) => filterWrite(field, field.signal.value)),
    )
    isInitializing.value = false
  }, [search])

  // signals → URL. Values are read first so this effect stays subscribed to every filter even on
  // the runs it skips.
  //
  // The read above flips `isInitializing`, which re-runs this effect after every address change —
  // including the ones this effect made. Without a comparison it would write every time: each
  // address change cost two history entries instead of one, so the browser's Back button did
  // nothing the first time it was pressed, and the write at mount replaced the whole address,
  // taking any fragment the page was carrying with it.
  useSignalEffect(() => {
    const pending = Object.values(fields).map((field) => filterWrite(field, field.signal.value))
    if (isInitializing.value) return

    const next = filterSearch(latestSearch.current, pending)
    if (next === agreed.current) return

    latestSearch.current = next
    agreed.current = next

    // Read the fragment here, at the moment of the write, rather than once when the hook mounted.
    // A page that keeps its route in the fragment moves it while this hook stays mounted, and the
    // one that has to survive is the one the address is carrying now.
    const fragment = globalThis.location.hash
    setSearchParams(new URLSearchParams(next))
    // The router's write is `history.pushState(state, "", pathname + "?" + search)`, which is a
    // target with no `#` — therefore an address with no fragment — and one ending in a bare `?`
    // when the query string came out empty. Tidying both through `replaceState` rather than
    // through a second `navigate` is what keeps the cost at one history entry per filter change,
    // and the router patches `replaceState` the same way it patches `pushState`, so it and every
    // listener subscribed through it are told about the address this leaves behind. Nothing here
    // fires a `hashchange` — the fragment never changed — and nothing scrolls the page back to the
    // anchor. A router told to defer its navigation is the case this misses: see the note in the
    // hook's own documentation above.
    const restored = restoredAddress(fragment, globalThis.location)
    if (restored !== undefined) {
      globalThis.history.replaceState(globalThis.history.state, "", restored)
    }
  })

  const clearFilters = (): void => clearFilterFields(fields)

  return {
    filters: Object.fromEntries(
      Object.entries(fields).map(([key, field]) => [key, field.signal]),
    ) as { [K in keyof T]: T[K]["signal"] },
    isInitializing,
    clearFilters,
  }
}
