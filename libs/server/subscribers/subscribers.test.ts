import { expect } from "@std/expect"
import { describe, it } from "@std/testing/bdd"
import {
  createListCrypto,
  DEV_SUBSCRIBERS_SECRET,
  readSubscribersSetup,
  subscriberConfirmLink,
  subscriberUnsubscribeLink,
} from "./subscribers.ts"

const SECRET = `test-subscribers-secret-${`x`.repeat(32)}`
const OLD_SECRET = `old-subscribers-secret-${`y`.repeat(32)}`

function env(values: Record<string, string>) {
  return { get: (name: string) => values[name] }
}

describe("subscriber setup", () => {
  it("reads the secret and the previous secrets", () => {
    const setup = readSubscribersSetup(
      env({ SUBSCRIBERS_SECRET: SECRET, SUBSCRIBERS_PREVIOUS_SECRETS: ` ${OLD_SECRET} , ` }),
      `prod`,
    )
    expect(setup).toEqual({ secret: SECRET, previousSecrets: [OLD_SECRET] })
  })

  it("turns subscriptions off in production without a secret", () => {
    expect(readSubscribersSetup(env({}), `prod`)).toBeNull()
  })

  it("signs with the public development secret only in development", () => {
    expect(readSubscribersSetup(env({}), `dev`)).toEqual({
      secret: DEV_SUBSCRIBERS_SECRET,
      previousSecrets: [],
    })
  })

  it("refuses a short secret without naming its value", () => {
    const cases: Record<string, string>[] = [
      { SUBSCRIBERS_SECRET: `short-secret` },
      { SUBSCRIBERS_SECRET: SECRET, SUBSCRIBERS_PREVIOUS_SECRETS: `short-secret` },
    ]
    for (const values of cases) {
      let message = ``
      try {
        readSubscribersSetup(env(values), `prod`)
      } catch (error) {
        message = (error as Error).message
      }
      expect(message).toMatch(/at least 32 printable characters/)
      expect(message).not.toContain(`short-secret`)
    }
  })

  it("refuses the cookie secret as the subscribers secret", () => {
    expect(() =>
      readSubscribersSetup(env({ SUBSCRIBERS_SECRET: SECRET, AUTH_COOKIE_SECRET: SECRET }), `prod`)
    ).toThrow(`must differ from AUTH_COOKIE_SECRET`)
  })

  it("a confirm token for one list does not verify for another", async () => {
    const setup = { secret: SECRET, previousSecrets: [] }
    const news = await createListCrypto(setup, `news`)
    // A second list, as an app that adds one would have it.
    const other = await createListCrypto(setup, `other` as `news`)
    const token = await news.confirmToken(`ada@example.com`)
    expect((await news.verifyConfirmToken(token)).ok).toBe(true)
    expect(await other.verifyConfirmToken(token)).toEqual({ ok: false, reason: `invalid` })
  })

  it("links carry the list and the token in the query", () => {
    const confirm = new URL(subscriberConfirmLink(`https://app.example.com`, `news`, `a+b/c=`))
    expect(confirm.pathname).toBe(`/subscribe/confirm`)
    expect(confirm.searchParams.get(`list`)).toBe(`news`)
    expect(confirm.searchParams.get(`token`)).toBe(`a+b/c=`)
    const unsubscribe = new URL(subscriberUnsubscribeLink(`https://app.example.com`, `news`, `t`))
    expect(unsubscribe.pathname).toBe(`/api/subscribers/unsubscribe`)
    expect(unsubscribe.searchParams.get(`token`)).toBe(`t`)
  })
})
