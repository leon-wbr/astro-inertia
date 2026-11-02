# astro-inertia: design

astro-inertia makes an Astro SSR app an Inertia client. The Inertia server (TYPO3 through `leon-wbr/inertia-typo3`, or Laravel, Rails, Django, AdonisJS) keeps routing, sessions, validation, auth and caching, and answers each request with a page object, `{component, props, url, version}`. Astro renders that page object to HTML on the server. The browser sees ordinary HTML pages, with no Inertia client JavaScript.

It speaks the plain Inertia protocol, version 3 (<https://inertiajs.com/the-protocol>, checked against inertia-laravel 3.x), so it needs nothing special from the server. A server-side adapter does not need to know that Astro is the client.

## Why a server-side client

An Inertia client normally runs in the browser. It sends `X-Inertia: true` on navigations and swaps components when JSON comes back. Here the Inertia client is the Astro server:

```
browser ──HTML──▶ Astro (SSR) ──X-Inertia: true──▶ Inertia server
        ◀─HTML──              ◀── page object JSON ──
```

That gives Astro's component model, islands and edge hosting on top of a backend that owns the routes. Inertia's own client router is not reimplemented. Plain links do full page loads, and smooth navigation comes from Astro's `<ClientRouter />` (view transitions), which fetches the next page's HTML through the same route.

## Request flow

The integration injects one catch-all route, `/[...inertia]`, at a lower priority than every route in `src/pages`, so an app's own Astro pages and endpoints keep working. For each request it does the following.

1. **Forward.** It sends the same method, path and query string to `backend` + path, with `redirect: "manual"` and a timeout (`timeout`, default 10 s, which ends in a 504 page). Headers:
   - Always `X-Inertia: true`, `X-Requested-With: XMLHttpRequest` and `Accept: text/html, application/xhtml+xml`. The Accept value is the one the Inertia client sends.
   - `X-Inertia-Version: <version>` on GET, when a version is configured.
   - The incoming `Cookie`, `Content-Type`, `Accept-Language`, `User-Agent`, `Authorization`, `Referer`, `Origin` and `X-XSRF-TOKEN`, plus the incoming `X-Inertia-*` headers (so partial reloads work). The list is configurable as `forwardHeaders`.
   - `X-Forwarded-Host`, `X-Forwarded-Proto`, `X-Forwarded-Port` and `X-Forwarded-For` describe the public request, so the backend builds absolute URLs for the public host. The backend has to trust Astro as a proxy (TYPO3 `reverseProxyIP`, Laravel `TrustProxies`).
   - The body is streamed through unchanged for non-GET and non-HEAD requests, whether URL-encoded, multipart or JSON.
2. **Classify the response.**

| Backend response                                        | What Astro does                                                                                                                                                                                              |
| ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `X-Inertia: true` + JSON                                | Parse and validate the page object, resolve `component`, render it with the backend's status code (so 404 and 500 pages stay 404 and 500).                                                                   |
| 3xx with `Location`                                     | Pass it through. A 302 after PUT, PATCH or DELETE becomes a 303, as the protocol requires. A `Location` on the backend's own origin is rewritten to a relative one, so the browser stays on the public host. |
| 409 + `X-Inertia-Location`, no `X-Inertia-Version`      | An external redirect (`Inertia::location()`). Answer with a 303 to that URL.                                                                                                                                 |
| 409 + `X-Inertia-Redirect`                              | A redirect to a URL with a fragment. Answer with a 303 to that URL, fragment included.                                                                                                                       |
| 409 + `X-Inertia-Version`                               | An asset version mismatch. See [Versioning](#versioning).                                                                                                                                                    |
| Anything else (HTML, a file, plain JSON, an error page) | Pass it through as is: status, body and headers.                                                                                                                                                             |

3. **Copy headers back.** `Set-Cookie` (every one, via `getSetCookie()`), `Cache-Control`, `Expires`, `Vary`, `Content-Language` and the cache-tag headers are copied onto the rendered HTML. The tag headers are `X-Cache-Tags`, `Cache-Tag`, `Surrogate-Key` and `xkey`, and the list is configurable. `X-Inertia` is removed from `Vary`, since browsers never send it. `Cookie` is added to `Vary` when a cookie was forwarded.

## Protocol mapping

| Page object field                                                             | Mapping                                                                                                                                                     |
| ----------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `component`                                                                   | Resolved to an Astro component (see below) and rendered with `props` spread as its props, plus `page` (the whole page object).                              |
| `props`                                                                       | Passed to the component. `errors` is always present (default `{}`), and `definePage()` types it.                                                            |
| `url`                                                                         | `Astro.locals.inertia.page.url`. It is used as the canonical path in deferred-prop requests.                                                                |
| `version`                                                                     | Compared and forwarded (see Versioning).                                                                                                                    |
| `deferredProps`                                                               | `<Deferred>` server islands (see below).                                                                                                                    |
| `mergeProps`, `prependProps`, `deepMergeProps`, `matchPropsOn`, `scrollProps` | Exposed on `page`. They only matter to a client that keeps state between visits. A server-rendered visit always gets complete props, so no merging is done. |
| `encryptHistory`, `clearHistory`, `preserveFragment`                          | Exposed, no effect. Astro does not write page state into `history.state`.                                                                                   |
| `onceProps`                                                                   | Exposed. `X-Inertia-Except-Once-Props` is never sent, so once props always arrive.                                                                          |
| `flash`, `sharedProps`, `rescuedProps`                                        | Exposed on `page`. A key in `rescuedProps` makes `<Deferred>` render its `error` component.                                                                 |
| `liveProps`                                                                   | Out of scope (needs a browser broadcaster).                                                                                                                 |

### Component resolution

By default every `.astro` file under `src/pages-inertia/` is a candidate, through `import.meta.glob`, so it is code-split and lazy. `Users/Index` resolves to `src/pages-inertia/Users/Index.astro`. A `resolve(name)` function in the runtime module can replace or extend this, for example to map TYPO3's `layout/default` to a different file. A component that resolves to nothing is a clear error, never a blank page. Astro answers with a 500 that names the component, the file it expected and the components it found.

## Versioning

`version` in the config is a string, or a `version(request)` function in the runtime module. It is the asset version or schema hash that this Astro build was made for. It is sent as `X-Inertia-Version` on GET requests. When the server answers 409 with `X-Inertia-Version`, the two disagree, and `onVersionMismatch` decides what happens:

- `"reload"` (the default) repeats the request without `X-Inertia-Version`. That is the server-side equivalent of the browser client's full page reload. It renders the result and adds `X-Astro-Inertia-Version-Mismatch: <server version>` to the response, and logs a warning once per server version.
- `"error"` renders a 502, which suits CI and staging environments that should fail loudly when the frontend is out of date.
- `onVersionMismatch(ctx)` in the runtime module, returning `"reload"`, `"error"` or a `Response`.

## Forms

Plain HTML forms post to the URL the backend expects, which Astro forwards. The backend validates, flashes errors into the session and redirects (302 or 303). Astro passes the redirect through, the browser follows it with a GET, and the backend puts `errors` from the session into the next page object. Nothing on the Astro side needs to know about forms. CSRF tokens stay the backend's business: a hidden `_token` field (Laravel) or TYPO3's form protection, read from props, plus the forwarded cookies. Multipart uploads stream through.

`X-Inertia-Error-Bag` can be sent with a hidden `_errorBag` field. Not implemented, because Inertia reads it from a header the browser cannot set on a plain form. The default error bag covers the common case.

## Deferred props

Deferred props must not block the first paint. There are two options.

- **Streaming.** Astro streams HTML in document order. An async component that awaits the partial reload holds back everything after it, so the content after the deferred prop arrives late. Only content before it gets the speedup.
- **Server islands (chosen).** `<Deferred page={page} data="default" render="Users/Stats">` renders its `fallback` slot in the first response. The browser then fetches the island, which makes one Inertia partial reload (`X-Inertia-Partial-Component: <component>`, `X-Inertia-Partial-Data: <keys>`) with the user's cookies, and swaps in the rendered result. The page is done and cacheable without the deferred data, and each island can be cached on its own. This is also how the browser Inertia client behaves: one request per group after the page has loaded.

The island needs to know what to render. Island props travel encrypted in the island's URL, so `<Deferred>` is a thin wrapper. It expands a group name to the keys that `deferredProps[group]` lists, then renders an internal `DeferredIsland` with `server:defer` and only the page's `url`, `component` and `version`, the keys and the component names. That keeps the island URL to about 300 characters, whatever the page's props are. The island renders the component named by `render`, resolved like page components, with the loaded props. When keys are missing, a key is listed in `rescuedProps`, or the request fails, it renders the component named by `error` instead, or a short message if there is none.

## Client side

- **Links:** plain `<a href>`. Each click is a normal request to Astro and a fresh render.
- **ClientRouter:** an app may add `<ClientRouter />` to its layout. Astro then fetches the next page's HTML and swaps it with a view transition. Forms are intercepted the same way, and redirects are followed by `fetch`. Nothing changes on the server.
- **Islands:** framework components (React, Svelte, Vue, …) are ordinary Astro islands. They get props explicitly from the page component. For islands that need the whole page object, `<InertiaPageData />` renders `<script type="application/json" id="inertia-page">` (the v3 markup), and `getPage()` from `astro-inertia/client` reads it.

## Types

`definePage<Props>(Astro)` returns `{ props, page }`, typed. With codegen, the generic is a component name instead of a props type:

```ts
const { props } = definePage<"Users/Index">(Astro);
```

Codegen is opt-in: `types: { schema: "./inertia.schema.json" }` (a path or URL). The schema is a JSON Schema object whose `properties` are component names and whose values are each component's props schema, which is what the TYPO3 design report proposes exporting from TCA. On `astro sync`, dev and build, `json-schema-to-typescript` turns it into `src/inertia.d.ts`, which augments `astro-inertia`'s `InertiaPages` interface. Without a schema, `definePage<Props>()` works on hand-written types.

## Caching

The response keeps the backend's caching headers: `Cache-Control`, `Vary` minus `X-Inertia`, and the cache-tag headers. A CDN in front of Astro can therefore purge by the backend's tags (TYPO3 `pageId_N`). Astro itself caches nothing. The integration never turns a private response public.

## Configuration

Options in `astro.config` are serialised into the build, so they are plain values. Functions go in a runtime module that the `runtime` option names.

```ts
inertia({
  backend: "http://typo3.internal", // optional: INERTIA_BACKEND is read at request time otherwise
  version: process.env.ASSET_VERSION, // asset version or schema hash, sent on GET
  onVersionMismatch: "reload", // "reload" | "error"
  timeout: 10_000, // ms; a timeout answers 504
  forwardHeaders: [...DEFAULT_FORWARD_HEADERS], // replaces the request header list
  extraForwardHeaders: ["x-tenant"], // or adds to it
  responseHeaders: [...DEFAULT_RESPONSE_HEADERS],
  cacheTagHeaders: ["x-cache-tags", "cache-tag", "surrogate-key", "xkey"],
  pagesDir: "src/pages-inertia",
  route: "/[...inertia]", // the injected catch-all
  runtime: "./src/inertia.runtime.ts", // resolve, backend, version, onVersionMismatch, transformPage
  types: { schema: "./inertia.schema.json", output: "src/inertia.d.ts" },
});
```

`X-Forwarded-Host` comes from `Astro.url`. Astro only trusts the incoming Host header for domains listed in `security.allowedDomains`, so production setups should list their public host there. Otherwise the backend sees `localhost`.

## Out of scope

- The browser-side Inertia router: `router.visit`, partial reloads from the browser, polling, prefetch, history encryption, scroll restoration and remembered state. `ClientRouter` covers navigation. An app that needs the full Inertia client should use `@inertiajs/react` on its own.
- Merge, prepend and deep-merge semantics, and infinite scroll. They depend on client-held state.
- Once props caching, live props and Precognition.
- SSR through Inertia's `/render` endpoint. Astro is the renderer.
- Caching inside Astro.
