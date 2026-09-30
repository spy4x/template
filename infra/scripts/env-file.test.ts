/// <reference lib="deno.ns" />
import { expect } from "@std/expect"
import { MissingEnvVarError, parseEnvValues, requireEnvVar } from "./env-file.ts"

Deno.test("parseEnvValues drops an inline comment after whitespace", () => {
  expect(parseEnvValues(`ENV=dev # or "prod"\nCONTAINER_PROVIDER=docker\t# or podman`)).toEqual({
    ENV: "dev",
    CONTAINER_PROVIDER: "docker",
  })
})

Deno.test("parseEnvValues keeps a # that has no whitespace before it", () => {
  expect(parseEnvValues(`DB_PASS=abc#def`)).toEqual({ DB_PASS: "abc#def" })
})

Deno.test("parseEnvValues keeps every = after the first", () => {
  expect(parseEnvValues(`TOKEN=YWJj==`)).toEqual({ TOKEN: "YWJj==" })
})

Deno.test("parseEnvValues skips comment lines and blank lines", () => {
  expect(parseEnvValues(`# SSH_TO_SERVER=old\n\nPROJECT=app\n`)).toEqual({ PROJECT: "app" })
})

Deno.test("parseEnvValues strips matching quotes and keeps a quoted #", () => {
  expect(parseEnvValues(`A="x # y"\nB='z'`)).toEqual({ A: "x # y", B: "z" })
})

Deno.test("parseEnvValues reads a value that is only a comment as empty", () => {
  expect(parseEnvValues(`PROXY_CF_API_KEY= # set in production`)).toEqual({
    PROXY_CF_API_KEY: "",
  })
})

Deno.test("parseEnvValues reads the shipped .env.example with ENV=dev", async () => {
  const values = parseEnvValues(
    await Deno.readTextFile(new URL("../envs/.env.example", import.meta.url)),
  )
  expect(values.ENV).toBe("dev")
  expect(values.CONTAINER_PROVIDER).toBe("docker")
})

Deno.test("requireEnvVar names the missing variable and the file, not a value", () => {
  expect(() => requireEnvVar({ PATH_ON_SERVER: "" }, "PATH_ON_SERVER", "infra/envs/.env.prod"))
    .toThrow(new MissingEnvVarError("PATH_ON_SERVER", "infra/envs/.env.prod"))
  expect(requireEnvVar({ A: "1" }, "A", "f")).toBe("1")
})
