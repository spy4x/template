import { expect } from "@std/expect"
import { describe, it } from "@std/testing/bdd"
import { readMpaConfig } from "./config.ts"

function env(values: Record<string, string>) {
  return { get: (name: string) => values[name] }
}

describe("readMpaConfig", () => {
  it("expects the browser at https outside development, as the API does", () => {
    expect(
      readMpaConfig(env({ ENV: "prod", DOMAIN: "app.example.com", API_URL: "http://api:8000" })),
    )
      .toEqual({ apiUrl: "http://api:8000", webAppOrigin: "https://app.example.com" })
  })

  it("expects the browser at plain http in development", () => {
    expect(
      readMpaConfig(env({ ENV: "dev", DOMAIN: "app.localhost:8080", API_URL: "http://api:8000" }))
        .webAppOrigin,
    ).toBe("http://app.localhost:8080")
  })

  it("refuses to start without the API's address", () => {
    expect(() => readMpaConfig(env({ ENV: "prod", DOMAIN: "app.example.com" })))
      .toThrow("API_URL is required")
  })
})
