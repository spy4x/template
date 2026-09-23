/**
 * Global arktype configuration: every schema built anywhere in this app rejects an object with
 * keys it did not declare, at any depth.
 *
 * `@spy4x/validation` and `@spy4x/platform/model` deliberately do not set this — arktype's own
 * `configure()` is a process-wide side effect, and a library mutating it for every consumer would
 * be a library imposing its own strictness choice on a host that may want something else. This
 * app wants strict rejection (the template's own `libs/platform/types` used to set it), so the
 * app sets it here, once.
 *
 * arktype requires this to run before any `type(...)` call anywhere in the module graph, so this
 * file must be the first import — before any other import — in every entry point that builds a
 * schema anywhere downstream: `apps/api/index.ts` and `apps/spa/src/main.tsx`.
 */
import { configure } from "arktype/config"

configure({ onUndeclaredKey: "reject", onDeepUndeclaredKey: "reject" })
