# Deno policy

Moved from the README. [ADR 001](decisions/001-deno-platform-template.md) records the decision.

- Use Deno runtime and `deno task` for development, checks, builds, and operations.
- Do not use Node.js, npm, pnpm, Yarn, or Bun commands.
- Selected `npm:` dependencies may run through Deno when required by Vite or Preact.
  This exception does not permit another runtime or task runner.
- New code, and old functions you change anyway, must run unchanged on Deno, Node and Bun. Use web
  standards (`fetch`, `Request`/`Response`, `URL`, Web Crypto, Web Streams) and `@std/*` packages
  that run on all three. Anything runtime-specific (`Deno.*`, `process`, `Bun.*`, `node:*`) goes
  behind a small adapter in `@spy4x/platform`, never in business code. Deno tests (`Deno.test`)
  and the Fresh app are exempt, and old code is not rewritten only to drop `Deno.*`.
