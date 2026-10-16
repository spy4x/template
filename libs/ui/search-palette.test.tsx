/**
 * `SearchPalette` in a browser DOM (happy-dom): what a person sees before and after typing, the
 * words for an answer from the device, which actions are offered, and what picking a row asks the
 * app to do.
 */
import { expect } from "@std/expect"
import { afterAll, afterEach, beforeAll, describe, it } from "@std/testing/bdd"
import { Window } from "happy-dom"
import { render } from "preact"
import { act } from "preact/test-utils"
import { GroupRole } from "@domain/groups"
import {
  emptyLabel,
  type SearchChoice,
  type SearchNotesAnswer,
  SearchPalette,
  type SearchPaletteProps,
} from "./search-palette.tsx"

const window = new Window({ url: "http://app.localhost/" })
const own = {
  document: globalThis.document,
  location: globalThis.location,
  getComputedStyle: globalThis.getComputedStyle,
}

beforeAll(() => {
  // The palette locks the page's scroll after reading its style (`getComputedStyle`).
  Object.assign(globalThis, {
    document: window.document,
    location: window.location,
    getComputedStyle: window.getComputedStyle.bind(window),
  })
})

afterAll(async () => {
  Object.assign(globalThis, own)
  await window.happyDOM.close()
})

let root: HTMLElement | null = null

afterEach(async () => {
  if (root) await act(() => render(null, root!))
  document.body.innerHTML = ""
  root = null
})

const HOME = { id: "group-home", name: "Home", role: GroupRole.OWNER }
const STUDIO = { id: "group-studio", name: "Acme Studio", role: GroupRole.VIEWER }
const PLAN = { id: "note-plan", groupId: HOME.id, title: "Weekly plan", snippet: "…call the bank…" }
const SKETCH = { id: "note-sketch", groupId: STUDIO.id, title: "", snippet: "" }

/** The palette with two groups, Home current and writable, online, notes from `answer`. */
async function mount(
  overrides: Partial<SearchPaletteProps> = {},
  answer: (query: string) => SearchNotesAnswer | Promise<SearchNotesAnswer> = () => ({
    notes: [PLAN, SKETCH],
    onDevice: false,
  }),
) {
  const asked: string[] = []
  const picked: SearchChoice[] = []
  root = document.createElement("div")
  document.body.append(root)
  await act(() =>
    render(
      <SearchPalette
        searchNotes={(query) => {
          asked.push(query)
          return Promise.resolve(answer(query))
        }}
        groups={[HOME, STUDIO]}
        currentGroup={{ id: HOME.id, name: HOME.name, canWrite: true }}
        online
        onSelect={(choice) => void picked.push(choice)}
        {...overrides}
      />,
      root!,
    )
  )
  return { asked, picked }
}

/** Waits past the palette's pause in typing, letting its search and renders finish. */
async function settle(): Promise<void> {
  await act(() => new Promise((resolve) => setTimeout(resolve, 260)))
}

function find<T extends Element = HTMLElement>(selector: string): T {
  const element = document.querySelector(selector)
  if (!element) throw new Error(`nothing matches ${selector}`)
  return element as unknown as T
}

async function open(): Promise<void> {
  await act(() => {
    find("[data-e2e=search-open]").dispatchEvent(
      new window.MouseEvent("click", { bubbles: true }) as unknown as Event,
    )
  })
  await settle()
}

async function type(value: string): Promise<void> {
  const field = find<HTMLInputElement>("[data-e2e=search] input")
  field.value = value
  await act(() => {
    field.dispatchEvent(new window.Event("input", { bubbles: true }) as unknown as Event)
  })
  await settle()
}

/** The list as a person reads it: each heading, then its rows' label and detail. */
function listed(): string[] {
  return [...document.querySelectorAll("[data-e2e=search] [role=listbox] > li")].flatMap((
    item,
  ) => {
    if (item.getAttribute("role") !== "group") return [text(item)]
    const heading = item.querySelector("[role=presentation]")?.textContent?.trim() ?? ""
    return [`# ${heading}`, ...[...item.querySelectorAll("[role=option]")].map(text)]
  })
}

function text(row: Element): string {
  return [...row.querySelectorAll("span, div")]
    .filter((part) => part.children.length === 0)
    .map((part) => part.textContent?.trim())
    .filter(Boolean)
    .join(" | ")
}

/** The status line under the list: the empty, loading or error words. */
function status(): string {
  return find("[data-e2e=search] [role=status]").textContent?.trim() ?? ""
}

describe("SearchPalette", () => {
  it("names its trigger after what it searches and shows Ctrl K", async () => {
    await mount()

    const trigger = find("[data-e2e=search-open]")
    expect(trigger.getAttribute("aria-label")).toBe("Search notes and groups")
    expect(trigger.getAttribute("aria-keyshortcuts")).toBe("Control+K /")
  })

  it("lists the current group's recent notes, then the actions, before anything is typed", async () => {
    const { asked } = await mount()

    await open()

    expect(asked).toEqual([""])
    expect(listed()).toEqual([
      "# Notes",
      "Weekly plan | Home · …call the bank…",
      "Untitled note | Acme Studio",
      "# Actions",
      "New note | In Home",
      "New tag | In Home",
      "New group",
      "Open notifications",
      "Open profile | Name, e-mail address, password, two-factor sign-in",
    ])
  })

  it("lists matching notes, then groups, then actions, with the role and the current group", async () => {
    await mount({}, () => ({ notes: [PLAN], onDevice: false }))
    await open()

    await type("  ho ")

    expect(listed()).toEqual([
      "# Notes",
      "Weekly plan | Home · …call the bank…",
      "# Groups",
      "Home | Owner | Current",
      "# Actions",
      "New note | In Home",
      "New tag | In Home",
    ])
  })

  it("names no group in a note row when the person has one group", async () => {
    await mount({ groups: [HOME] })

    await open()

    expect(listed()[1]).toBe("Weekly plan | …call the bank…")
  })

  it("heads the notes from the device as such, and says so when nothing matches", async () => {
    await mount(
      {},
      (query) => query === "zz" ? { notes: [], onDevice: true } : { notes: [PLAN], onDevice: true },
    )
    await open()

    await type("plan")
    expect(listed()[0]).toBe("# Notes on this device")

    await type("zz")
    expect(listed()).toEqual([])
    expect(status()).toBe(
      "Nothing on this device matches “zz”. Search again when you are back online.",
    )
  })

  it("repeats a long query cut to forty characters when nothing matches", async () => {
    await mount({}, () => ({ notes: [], onDevice: false }))
    await open()

    await type(`${"x".repeat(45)}`)

    expect(status()).toBe(`No notes or groups match “${"x".repeat(40)}…”.`)
    expect(emptyLabel("  ab  ", false)).toBe("No notes or groups match “ab”.")
  })

  it("does not search notes for a single character, but still matches groups", async () => {
    const { asked } = await mount()
    await open()

    await type("a")

    expect(asked).toEqual([""])
    expect(listed()).toContain("Acme Studio | Viewer")
  })

  it("offers no new note or tag in a group the person may only read, and no new group offline", async () => {
    await mount({
      currentGroup: { id: STUDIO.id, name: STUDIO.name, canWrite: false },
      online: false,
    })

    await open()

    const rows = listed()
    for (const action of ["New note", "New tag", "New group"]) {
      expect(rows.some((row) => row.startsWith(action))).toBe(false)
    }
    expect(rows).toContain("Open notifications")
  })

  it("shows the error line when the search fails", async () => {
    await mount(
      {},
      (query) => query === "" ? { notes: [], onDevice: false } : Promise.reject(new Error("429")),
    )
    await open()

    await type("plan")

    expect(status()).toBe("Could not search. Change the text to try again.")
  })

  it("asks the app to open a picked note in its group, and a picked group's page", async () => {
    const { picked } = await mount()
    await open()

    await act(() => {
      find("[role=option]").dispatchEvent(
        new window.MouseEvent("click", { bubbles: true }) as unknown as Event,
      )
    })
    await open()
    await type("acme")
    const group = [...document.querySelectorAll("[role=option]")]
      .find((row) => text(row).startsWith("Acme Studio |"))!
    await act(() => {
      group.dispatchEvent(new window.MouseEvent("click", { bubbles: true }) as unknown as Event)
    })

    expect(picked).toEqual([
      { kind: "note", noteId: PLAN.id, groupId: HOME.id },
      { kind: "group", groupId: STUDIO.id },
    ])
  })

  it("picks the first result with Enter", async () => {
    const { picked } = await mount()
    await open()

    await act(() => {
      find("[data-e2e=search] input").dispatchEvent(
        new window.KeyboardEvent("keydown", { key: "Enter", bubbles: true }) as unknown as Event,
      )
    })

    expect(picked).toEqual([{ kind: "note", noteId: PLAN.id, groupId: HOME.id }])
  })
})
