import { SiteFrame } from "../site.tsx"
import { define } from "../utils.ts"

/** The home page: a placeholder that points at the app until the public website lands. */
export default define.page(function Home({ state }) {
  return (
    <SiteFrame spaOrigin={state.spaOrigin}>
      <h1 class="text-2xl font-semibold">Template</h1>
      <p class="mt-4">
        An open-source SaaS starter on Deno. <a href={`${state.spaOrigin}/`}>Open the app</a> or
        {" "}
        <a href="/subscribe">subscribe to the newsletter</a>.
      </p>
    </SiteFrame>
  )
})
