import { define } from "../utils.ts"

export default define.page(function App({ Component }) {
  return (
    <html lang="en" class="h-full">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <title>Template</title>
      </head>
      <body class="theme-base min-h-full">
        <Component />
      </body>
    </html>
  )
})
