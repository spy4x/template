import { Head } from "fresh/runtime"
import { SEOHead } from "@spy4x/preact-system/seo-head"
import { define } from "../utils.ts"

const title = "Deno Platform Template"
const description = "Server-rendered multipage application foundation."

export default define.page(function Home(ctx) {
  const canonicalUrl = new URL("/", ctx.url).href

  return (
    <>
      <Head>
        <SEOHead title={title} description={description} canonical={canonicalUrl} />
      </Head>
      <main>
        <h1>{title}</h1>
        <p>{description}</p>
      </main>
    </>
  )
})
