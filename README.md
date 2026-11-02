# astro-inertia

> [!WARNING]
> **Highly experimental, work in progress.** The API, configuration and behaviour can change in any release, without notice or a migration path. It isn't published to npm yet. Don't use it in production.

Astro as an [Inertia](https://inertiajs.com) client, rendering on the server.

Your Inertia server (Laravel, Rails, Django, AdonisJS, or TYPO3 through [`leon-wbr/inertia-typo3`](https://github.com/leon-wbr/inertia-typo3)) keeps routing, sessions, validation and auth, and answers each request with a page object: `{ component, props, url, version }`. astro-inertia forwards each request to it with `X-Inertia: true` and renders the Astro component that `component` names. The browser gets plain HTML.

It speaks the standard Inertia protocol (v3), so the server needs no changes. Any Inertia server works.

```
browser ──HTML──▶ Astro (SSR) ──X-Inertia: true──▶ Inertia server
        ◀─HTML──              ◀── page object (JSON) ──
```

The design and its trade-offs are in [docs/design.md](docs/design.md).

## Install

Requires Astro 7 with an SSR adapter, for example `@astrojs/node`.

```sh
pnpm add astro-inertia @astrojs/node
```

```js
// astro.config.mjs
import node from "@astrojs/node";
import { defineConfig } from "astro/config";
import inertia from "astro-inertia";

export default defineConfig({
  output: "server",
  adapter: node({ mode: "standalone" }),
  // Astro.url, and so X-Forwarded-Host, only trusts the Host header for these.
  security: { allowedDomains: [{ hostname: "example.org" }] },
  integrations: [inertia({ backend: "http://app.internal", version: process.env.ASSET_VERSION })],
});
```

Put one Astro component per Inertia component in `src/pages-inertia/`. `Users/Index` renders `src/pages-inertia/Users/Index.astro`.

```astro
---
// src/pages-inertia/Users/Index.astro
import { definePage } from "astro-inertia";
import Layout from "../../layouts/Layout.astro";

const { props, page } = definePage<{ users: { id: number; name: string }[] }>(Astro);
---

<Layout title="Users" page={page}>
  <ul>
    {props.users.map((user) => (
      <li>{user.name}</li>
    ))}
  </ul>
</Layout>
```

Your own routes in `src/pages/` still win. astro-inertia only injects a low-priority catch-all, `/[...inertia]`.

## Configuration

| Option                | Default                                                      | Meaning                                                                                                                             |
| --------------------- | ------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------- |
| `backend`             | `INERTIA_BACKEND` at runtime                                 | Base URL of the Inertia server. A base path (`http://app/site`) is kept.                                                            |
| `version`             | none                                                         | Asset version or schema hash this frontend was built for. Sent as `X-Inertia-Version` on GET.                                       |
| `onVersionMismatch`   | `"reload"`                                                   | On a 409 version mismatch, `"reload"` renders without the check and sets `X-Astro-Inertia-Version-Mismatch`. `"error"` answers 502. |
| `timeout`             | `10000`                                                      | Backend timeout in ms. A timeout answers 504; an unreachable backend answers 502.                                                   |
| `forwardHeaders`      | cookie, content-type, accept-language, authorization, …      | Request headers copied to the backend. Replaces the default list.                                                                   |
| `extraForwardHeaders` | `[]`                                                         | Added to the default list.                                                                                                          |
| `responseHeaders`     | cache-control, expires, vary, content-language, x-robots-tag | Copied from a page-object response onto the HTML.                                                                                   |
| `cacheTagHeaders`     | x-cache-tags, cache-tag, surrogate-key, xkey                 | Cache-tag headers copied through for CDN purges.                                                                                    |
| `pagesDir`            | `src/pages-inertia`                                          | Where components are looked up.                                                                                                     |
| `route`               | `/[...inertia]`                                              | The injected catch-all.                                                                                                             |
| `runtime`             | none                                                         | A module whose exports add functions (see below).                                                                                   |
| `types`               | none                                                         | `{ schema, output? }`: generate prop types from a JSON Schema.                                                                      |

Options in `astro.config` are serialised into the build, so functions go in the `runtime` module:

```ts
// src/inertia.runtime.ts (runtime: "./src/inertia.runtime.ts")
import type { RuntimeOptions } from "astro-inertia";

// Map names the default lookup doesn't cover; return undefined to fall back.
export const resolve: RuntimeOptions["resolve"] = (name) =>
  name.startsWith("layout/") ? import(`./layouts/${name.slice(7)}.astro`) : undefined;

export const backend: RuntimeOptions["backend"] = (request) =>
  new URL(request.url).hostname.endsWith(".de") ? "http://de.internal" : "http://app.internal";
export const version: RuntimeOptions["version"] = () => process.env.ASSET_VERSION;
export const onVersionMismatch: RuntimeOptions["onVersionMismatch"] = ({ serverVersion }) => "reload";
export const transformPage: RuntimeOptions["transformPage"] = (page) => page;
```

## How it maps the protocol

Each request is forwarded with its method, body, cookies and the configured headers. Astro also sends `X-Inertia: true`, `X-Requested-With: XMLHttpRequest`, the version, and `X-Forwarded-Host`, `-Proto`, `-Port` and `-For`. Redirects are never followed by Astro.

| The server answers                        | Astro answers                                                                                                                                              |
| ----------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `X-Inertia: true` + page object           | The rendered component, with the server's status, `Set-Cookie`, caching headers and cache tags. `X-Inertia` is dropped from `Vary`, and `Cookie` is added. |
| 3xx + `Location`                          | The same redirect. A 302 after PUT, PATCH or DELETE becomes a 303. A `Location` on the server's own origin becomes a path.                                 |
| 409 + `X-Inertia-Location`                | A 303 to that URL (`Inertia::location()`).                                                                                                                 |
| 409 + `X-Inertia-Redirect`                | A 303 to that URL, fragment included.                                                                                                                      |
| 409 + `X-Inertia-Version`                 | A version mismatch: see `onVersionMismatch`.                                                                                                               |
| Anything else (HTML, files, JSON, errors) | Passed through unchanged.                                                                                                                                  |
| A `component` with no matching file       | A 500 that names the component, the file it expected and the components it found.                                                                          |

**Forms** are plain HTML forms. The server validates, flashes errors to the session and redirects. The browser follows the redirect, and the next page object carries `errors`. `errorFor(errors, "email")` returns the first message. Multipart uploads stream through.

**Deferred props** load through a server island. The first response carries the fallback, and the island makes one partial reload (`X-Inertia-Partial-Component` and `X-Inertia-Partial-Data`) after the page has loaded:

```astro
---
import Deferred from "astro-inertia/Deferred.astro";
---

<Deferred page={page} data="default" render="Users/Stats" error="Users/StatsError">
  <p slot="fallback">Loading…</p>
</Deferred>
```

`data` is a deferred group or a prop key. `render` and `error` are component names, resolved like pages.

**Navigation.** Plain links work. For smooth navigation, add `<ClientRouter />` from `astro:transitions` to your layout: Astro fetches the next page through the same route and swaps it with a view transition. Forms submitted through it follow redirects too.

**Islands.** Framework islands (React, Svelte, Vue, …) take page props the usual Astro way: `<UserFilter client:load users={props.users} />`. For the whole page object in the browser, render `<InertiaPageData page={page} />` (the v3 `<script type="application/json" data-page="app">` markup) and read it with `getPage()` from `astro-inertia/client`.

**Caching.** The server's `Cache-Control`, `Vary` and cache-tag headers reach the CDN unchanged, so you can purge by the server's tags (TYPO3's `pageId_N`). Astro adds no caching of its own.

## Types

`definePage<Props>(Astro)` types a component's props by hand. To generate them instead, point `types.schema` at a JSON Schema (a file path or an http(s) URL) whose `properties` are component names and whose values are each component's props schema:

```json
{
  "type": "object",
  "properties": {
    "Users/Index": {
      "type": "object",
      "properties": { "users": { "type": "array", "items": { "$ref": "#/$defs/User" } } },
      "required": ["users"]
    }
  },
  "$defs": { "User": { "type": "object", "properties": { "name": { "type": "string" } }, "required": ["name"] } }
}
```

On `astro dev`, `build` and `sync`, astro-inertia writes `src/inertia.d.ts`, and `definePage<"Users/Index">(Astro)` is then typed by name. `examples/basic/inertia.schema.json` is a complete schema.

## Limits

- No browser-side Inertia router. There's no `router.visit`, client-side partial reloads, polling, prefetch, scroll restoration, remembered state or history encryption. `ClientRouter` covers navigation. If you need the full client, use `@inertiajs/react` or `@inertiajs/vue3` instead.
- Merge, prepend and deep-merge props, infinite scroll, once props and live props are exposed on `page`, but nothing acts on them. Each server render gets complete props.
- `X-Inertia-Error-Bag` can't be set from a plain HTML form. The default error bag works.
- All page components share one route, so Astro bundles the CSS of every component in `pagesDir` for each page. Keep component styles scoped (Astro's default) and small.
- Precognition and Inertia's own SSR endpoint are not used.

## Examples

### TYPO3

`examples/typo3` renders the DDEV example from [`leon-wbr/inertia-typo3`](https://github.com/leon-wbr/inertia-typo3) (TYPO3 14 with the Inertia 3 adapter). TYPO3 keeps the page tree, languages, redirects and access. Astro renders `contentElements` and the navigation.

```sh
pnpm typo3:up        # clones the adapter branch to .cache/, ddev start + setup
pnpm --filter example-typo3 dev   # INERTIA_BACKEND=https://inertia-typo3.ddev.site
pnpm test:e2e:typo3
pnpm typo3:down      # ddev stop
```

The TYPO3 site's `base` is `/`, so it answers for whatever host Astro forwards. With an absolute base, put the public host there and add Astro to TYPO3's `reverseProxyIP`.

### Laravel

Nothing changes on the Laravel side: a stock `inertiajs/inertia-laravel` 3.x app with `HandleInertiaRequests` works. In Astro:

```js
inertia({ backend: "http://laravel.internal", version: process.env.VITE_MANIFEST_HASH });
```

```astro
---
// src/pages-inertia/Users/Index.astro, for Inertia::render('Users/Index', ['users' => ...])
import { definePage, errorFor } from "astro-inertia";
const { props } = definePage<{ users: { id: number; name: string }[] }>(Astro);
---

<form method="post" action="/users">
  <input type="hidden" name="_token" value={props.csrf_token as string} />
  <input name="name" />
  {errorFor(props.errors, "name") && <p>{errorFor(props.errors, "name")}</p>}
  <button>Add</button>
</form>
```

Share the CSRF token as a prop, for example `'csrf_token' => csrf_token()` in `HandleInertiaRequests::share()`, because plain forms post `_token`. Trust Astro as a proxy (`TrustProxies`) so Laravel builds URLs for the public host. Laravel's version is the hash of the Vite manifest, so set `version` to the same value.

## Development

```sh
pnpm install
pnpm verify          # format, lint, build, typecheck, unit tests, e2e (mock + TYPO3)
pnpm test            # unit tests (Vitest)
pnpm test:e2e:mock   # Playwright against the mock Inertia server
```

The layout is:

- `packages/astro-inertia`: the integration.
- `tests/mock-server`: a small Inertia v3 server.
- `examples/basic`: an app against the mock.
- `examples/typo3`: an app against TYPO3.
- `tests/e2e`: Playwright.

### Versions

Node 26 LTS (`.nvmrc`), pnpm 12.16 (`packageManager`), Astro 7, Vite as Astro ships it, ESLint 10, Vitest 5 and Playwright 1.64. The package, the mock server and the e2e suite type-check with TypeScript 7.

There is one exception. The workspace root and the two examples pin TypeScript 6.0.3, because their TypeScript consumers need the classic compiler API, which TypeScript 7 no longer ships: typescript-eslint (peer `<6.1`) and `astro check` (Volar, peer `^5 || ^6`). `pnpm outdated` lists only this.

## License

[MIT](LICENSE), like Inertia and Astro.
