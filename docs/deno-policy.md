# Deno policy

Moved from the README. [ADR 001](decisions/001-deno-platform-template.md) records the decision.

- Use Deno runtime and `deno task` for development, checks, builds, and operations.
- Do not use Node.js, npm, pnpm, Yarn, or Bun commands.
- Selected `npm:` dependencies may run through Deno when required by Vite, Preact, or Dexie.
  This exception does not permit another runtime or task runner.
