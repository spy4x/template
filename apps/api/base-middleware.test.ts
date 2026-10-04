import { expect } from "@std/expect"
import { describe, it } from "@std/testing/bdd"
import { Hono } from "hono"
import { HTTPException } from "hono/http-exception"
import type { APIContext } from "./_types.ts"
import { applyBaseMiddleware } from "./base-middleware.ts"

function app() {
  const app = new Hono<APIContext>().basePath("/api")
  applyBaseMiddleware(app, { write: () => {}, parseAuth: async (_c, next) => await next() })
  app.get("/id", (c) => c.text(c.get("requestId")))
  return app
}

describe("the request id of an API call", () => {
  it("keeps an X-Request-Id of 128 characters whole", async () => {
    const id = "r".repeat(128)

    const response = await app().request("/api/id", { headers: { "X-Request-Id": id } })

    expect(await response.text()).toBe(id)
  })

  it("replaces an X-Request-Id of 129 characters, so it fits the audit column", async () => {
    const response = await app().request("/api/id", {
      headers: { "X-Request-Id": "r".repeat(129) },
    })

    const id = await response.text()
    expect(id.length).toBeGreaterThan(0)
    expect(id.length).toBeLessThanOrEqual(128)
  })
})

describe("an unhandled exception in an API route", () => {
  function failing(reported: { error: unknown; context: unknown }[], logged: unknown[][] = []) {
    const app = new Hono<APIContext>().basePath("/api")
    applyBaseMiddleware(app, {
      write: (...data) => logged.push(data),
      parseAuth: async (_c, next) => await next(),
      reportError: (error, context) => reported.push({ error, context }),
    })
    app.post("/boom", () => {
      throw new Error("db exploded")
    })
    app.get("/teapot", () => {
      throw new HTTPException(418, { message: "teapot" })
    })
    app.get("/unavailable", () => {
      throw new HTTPException(503, { message: "later" })
    })
    return app
  }

  it("answers 500 and reports it with the request id, method and path only", async () => {
    const reported: { error: unknown; context: unknown }[] = []
    const logged: unknown[][] = []

    const response = await failing(reported, logged).request("/api/boom?token=SECRET", {
      method: "POST",
      headers: { "X-Request-Id": "req-1", Cookie: "sid=COOKIE", Authorization: "Bearer BEARER" },
      body: JSON.stringify({ password: "BODYSECRET" }),
    })

    expect(response.status).toBe(500)
    const failures = logged.filter((l) => String(l[0]).startsWith("error: unhandled"))
    expect(failures).toHaveLength(1)
    expect(failures[0][0]).toBe("error: unhandled exception on POST /api/boom")
    expect((failures[0][1] as Error).message).toBe("db exploded")
    expect(reported).toHaveLength(1)
    expect((reported[0].error as Error).message).toBe("db exploded")
    expect(reported[0].context).toEqual({
      tags: { request_id: "req-1" },
      request: { method: "POST", path: "/api/boom" },
    })
    const serialised = JSON.stringify(reported[0].context)
    for (const secret of ["SECRET", "COOKIE", "BEARER", "BODYSECRET"]) {
      expect(serialised).not.toContain(secret)
    }
  })

  it("does not report an HTTPException below 500 but answers it as before", async () => {
    const reported: { error: unknown; context: unknown }[] = []

    const response = await failing(reported).request("/api/teapot")

    expect(response.status).toBe(418)
    expect(reported).toEqual([])
  })

  it("reports an HTTPException of 500 or more and keeps its status", async () => {
    const reported: { error: unknown; context: unknown }[] = []

    const response = await failing(reported).request("/api/unavailable")

    expect(response.status).toBe(503)
    expect(reported).toHaveLength(1)
  })

  it("still answers 500 when reporting itself throws", async () => {
    const app = new Hono<APIContext>().basePath("/api")
    applyBaseMiddleware(app, {
      write: () => {},
      parseAuth: async (_c, next) => await next(),
      reportError: () => {
        throw new Error("tracker library broke")
      },
    })
    app.get("/boom", () => {
      throw new Error("x")
    })

    expect((await app.request("/api/boom")).status).toBe(500)
  })

  it("reports and logs once an error a route's own onError answered, and keeps that answer", async () => {
    const reported: { error: unknown; context: unknown }[] = []
    const logged: unknown[][] = []
    const app = new Hono<APIContext>().basePath("/api")
    applyBaseMiddleware(app, {
      write: (...data) => logged.push(data),
      parseAuth: async (_c, next) => await next(),
      reportError: (error, context) => reported.push({ error, context }),
    })
    const notes = new Hono<APIContext>()
      .get("/", () => {
        throw new Error("db down")
      })
      .onError((_error, c) => c.json({ error: { code: "INTERNAL_ERROR" } }, 500))
    app.route("/notes", notes)

    const response = await app.request("/api/notes", { headers: { "X-Request-Id": "req-7" } })

    expect(response.status).toBe(500)
    expect(await response.json()).toEqual({ error: { code: "INTERNAL_ERROR" } })
    expect(reported).toHaveLength(1)
    expect((reported[0].error as Error).message).toBe("db down")
    expect(reported[0].context).toEqual({
      tags: { request_id: "req-7" },
      request: { method: "GET", path: "/api/notes" },
    })
    expect(logged.filter((l) => String(l[0]).startsWith("error: unhandled"))).toHaveLength(1)
  })
})
