# Security headers

The SPA and the MPA send the header set of `securityHeaders` in
[`@spy4x/server/http/security-headers`](https://jsr.io/@spy4x/server/doc), with every response,
error pages included. The API does not send it yet
([issue 311](https://github.com/spy4x/template/issues/311)).

| Header                                                               | What it does                                                                |
| -------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| `Content-Security-Policy`                                            | Names everything a page may load or run; the tables below list it.          |
| `X-Content-Type-Options: nosniff`                                    | The browser never guesses a file's type, so an upload cannot run as script. |
| `Referrer-Policy: no-referrer`                                       | No address leaves in a `Referer`; some carry a reset code or a token.       |
| `X-Frame-Options: DENY`, and `frame-ancestors 'none'` in the policy  | No site can show the app in a frame to trick a click.                       |
| `Strict-Transport-Security: max-age=15552000; includeSubDomains`     | For 180 days the browser reaches the domain and its subdomains over HTTPS only. |
| `Cross-Origin-Opener-Policy` and `Cross-Origin-Resource-Policy: same-origin` | Another site can neither hold a handle on the app's window nor embed its files. |
| `Origin-Agent-Cluster`, `X-DNS-Prefetch-Control`, `X-Download-Options`, `X-Permitted-Cross-Domain-Policies`, `X-XSS-Protection: 0` | The remaining defaults of Hono's `secureHeaders`, which the helper wraps. |

`Strict-Transport-Security` covers subdomains: every host under the product's domain (Grafana,
MinIO, the MPA) must be served over HTTPS, as the production Compose file does. A browser ignores
the header over plain HTTP, so development is not affected.

## The SPA's policy

| Directive         | Allows                                                                                       | Why                                                                                                   |
| ----------------- | -------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `default-src`     | `'self'`                                                                                     | Anything not named below comes from the app's own origin: the web manifest, for one.                   |
| `script-src`      | `'self'` and one `'sha256-…'`                                                                | The built files under `/assets/`, the service worker `/sw.js`, and the inline script that paints the stored theme before the first frame. No `'unsafe-inline'`, no `'unsafe-eval'`. |
| `style-src`       | `'self'`, one `'sha256-…'`, `https://fonts.googleapis.com`                                   | The built stylesheet, the inline `<style>` of `index.html`, and the Google Fonts stylesheet it links. |
| `font-src`        | `'self'`, `https://fonts.gstatic.com`                                                        | The font files that stylesheet names.                                                                 |
| `img-src`         | `'self'`, `data:`                                                                            | The icons, and the two-factor QR code, which the profile screen builds as a `data:` address.          |
| `connect-src`     | `'self'`, and the origin of `SPA_ERROR_REPORT_DSN` when it is set                            | The API and its WebSocket (`/api`, on the app's origin), `/config.json`, and the error tracker.       |
| `object-src`      | `'none'`                                                                                     | No plugins.                                                                                           |
| `base-uri`        | `'self'`                                                                                     | An injected `<base>` cannot move the app's relative addresses to another site.                        |
| `form-action`     | `'self'`                                                                                     | A form posts to the app only.                                                                         |
| `frame-ancestors` | `'none'`                                                                                     | No framing.                                                                                           |

The service worker and the web manifest need no directive of their own: `worker-src` falls back to
`script-src` and `manifest-src` to `default-src`.

### How nginx gets it

nginx serves the SPA, so the library's middleware cannot run there. Two files carry the headers
into `apps/spa/nginx.conf`:

- **At build:** a plugin in `apps/spa/vite.config.ts` reads the built `dist/index.html` and writes
  `apps/spa/security-headers.conf`, one `add_header … always;` line per header
  (`libs/client/vite/nginx-security-headers.ts`). It calls the library's `securityHeaders` with the
  built page, so the hashes always match the inline blocks of that build: a library update that
  changes the theme script changes the hash with it. The file is not committed.
- **At container start:** `apps/spa/csp-connect.sh` writes `/tmp/csp-connect.conf`, which sets the
  nginx variable `$csp_error_tracker` to the origin of `SPA_ERROR_REPORT_DSN`, or to nothing. One
  image serves every environment, and the tracker is the only part of the policy that differs
  between them. The script accepts an `http` or `https` address made of letters, digits and
  `.:/@_-` only; anything else stops the container, naming the variable and not its value, because
  the origin lands inside nginx configuration.

nginx drops every inherited `add_header` in a block that has one of its own, so each `location`
that adds a header includes the file again. A new `location` with an `add_header` must do the same;
`e2e/spa/security-headers.spa.ts` checks the ones that exist.

The Vite dev server sends none of these headers: it injects inline scripts and styles of its own
that no fixed policy fits. The policy is therefore checked against the production image.

### Letting the app load something new

Add the source to `EXTRA_SOURCES` in `libs/client/vite/nginx-security-headers.ts`, add it to the
list in `nginx-security-headers.test.ts`, which names every source beyond the app itself, and to
the table above. Prefer serving the file from the app's own origin, which needs no change.

### One refusal to expect

arktype, the validation library, tries `new Function` once per page load, inside a `try`, to learn
whether it may compile its validators. The policy refuses it, the browser records the refusal, and
arktype validates without compiling. The app works; the walk in `e2e/spa` expects this refusal and
no other.

## The MPA's policy

The MPA's pages load one stylesheet from their own origin and no script, inline block, image or
font, so the policy is the helper's default with nothing added: `'self'` for `default-src`,
`script-src`, `style-src` and `connect-src`; `'self'` and `data:` for `img-src`; `object-src
'none'`; `base-uri 'self'`; `frame-ancestors 'none'`.

`form-action` is `'self'`, plus the SPA's origin when the MPA runs on a domain of its own
(`MPA_DOMAIN` differs from `DOMAIN`). The pricing page's form posts to the MPA, which redirects to
the SPA's sign-up, and a browser applies `form-action` to that redirect as well.

`securityHeadersMiddleware` in `apps/mpa/middleware.ts` sets the headers. It runs first, before the
static files, and also answers an error no route caught (the 404 of an unknown address, a 500),
because Fresh would answer those outside every middleware, without the headers.

## Tests

| What                                                                          | Where                                                    | Runs in                                  |
| ----------------------------------------------------------------------------- | -------------------------------------------------------- | ---------------------------------------- |
| The MPA's headers on a page, a 404, a 500 and a refusal                        | `apps/mpa/app.test.ts`                                   | `deno task check`                        |
| The MPA's headers on real responses; a walk with no refusal under the policy   | `e2e/mpa/security-headers.mpa.ts`                        | `e2e/mpa/run.sh` (CI step `e2e-mpa`)     |
| The SPA's policy: its sources, the hashes of the inline blocks, the nginx lines | `libs/client/vite/nginx-security-headers.test.ts`        | `deno task check`                        |
| The tracker origin the container writes, and what it refuses                   | `tests/spa-runtime-config.test.ts`                       | `deno task check`                        |
| nginx's real responses; a signed-in walk with no refusal under the policy      | `e2e/spa/security-headers.spa.ts`                        | `e2e/spa/run.sh`, on a machine with a container tool |

`e2e/spa/run.sh` builds the image of `apps/spa/dockerfile.prod`, starts it beside the API and runs
the specs against it. It needs a container tool, which the CI steps do not have, so CI does not run
it yet; run it before changing `nginx.conf`, the policy or the page's inline blocks.
