import { Head } from "fresh/runtime"
import { define } from "../utils.ts"

const title = "Deno Platform Template"
const description = "Server-rendered multipage application foundation."

export default define.page(function Home(ctx) {
  const canonicalUrl = new URL("/", ctx.url).href

  return (
    <>
      <Head>
        <title>{title}</title>
        <meta name="description" content={description} />
        <link rel="canonical" href={canonicalUrl} />
      </Head>
      <main>
        <h1>{title}</h1>
        <p>{description}</p>
      </main>
    </>
  )
})
