import { expect } from "@std/expect"
import { describe, it } from "@std/testing/bdd"
import { prefixQuery, SNIPPET_MAX_LENGTH, trimSnippet } from "./note-search.ts"

describe(`prefixQuery`, () => {
  it(`requires every word, each as the start of a word`, () => {
    expect(prefixQuery(`Weekly  Plan`)).toBe(`weekly:* & plan:*`)
  })

  it(`drops every character that could add a query operator`, () => {
    expect(prefixQuery(`a&b | !c <-> 'd':* (e)`)).toBe(`a:* & b:* & c:* & d:* & e:*`)
  })

  it(`keeps letters and digits of any script`, () => {
    expect(prefixQuery(`Привет 2026`)).toBe(`привет:* & 2026:*`)
  })

  it(`answers null when no word is left`, () => {
    expect(prefixQuery(`!! --`)).toBeNull()
  })

  it(`takes the first eight words only`, () => {
    expect(prefixQuery(`a b c d e f g h i j`)?.split(` & `).length).toBe(8)
  })
})

describe(`trimSnippet`, () => {
  it(`marks a cut start and a cut end with an ellipsis`, () => {
    expect(trimSnippet(`middle of the body`, false, false)).toBe(`…middle of the body…`)
  })

  it(`adds no ellipsis where the snippet reaches the body's ends`, () => {
    expect(trimSnippet(`the whole body`, true, true)).toBe(`the whole body`)
  })

  it(`folds line breaks into spaces`, () => {
    expect(trimSnippet(`first\n\nsecond`, true, true)).toBe(`first second`)
  })

  it(`cuts a long snippet on a word boundary within the maximum length`, () => {
    const snippet = trimSnippet(`word `.repeat(60), true, true)

    expect(Array.from(snippet).length).toBeLessThanOrEqual(SNIPPET_MAX_LENGTH)
    expect(snippet.endsWith(`word…`)).toBe(true)
  })

  it(`answers an empty snippet for an empty body`, () => {
    expect(trimSnippet(``, true, true)).toBe(``)
  })
})
