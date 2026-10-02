import { renderPricing } from "../../../billing.tsx"
import { define } from "../../../utils.ts"

/** The plans a group can move to: `GET` shows them, with a checkout form for the owner. */
export const handler = define.handlers({
  GET: (ctx) => renderPricing(ctx),
})
