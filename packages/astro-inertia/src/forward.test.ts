import { describe, expect, it } from "vitest";
import {
  backendUrl,
  buildBackendRequest,
  classifyResponse,
  forwardHeaders,
  pageResponseHeaders,
  passthrough,
  redirectResponse,
  rewriteLocation,
  rewriteVary,
} from "./forward.js";
import { resolveOptions } from "./options.js";

const options = resolveOptions();
const publicUrl = new URL("https://example.org/de/ueber-uns?x=1");
const backend = "http://typo3.internal";

function incoming(init: RequestInit & { url?: string } = {}): Request {
  return new Request(init.url ?? publicUrl, init);
}

describe("backendUrl", () => {
  it("keeps path and query", () => {
    expect(backendUrl(backend, "/de/ueber-uns?x=1").href).toBe("http://typo3.internal/de/ueber-uns?x=1");
  });
  it("joins a backend base path", () => {
    expect(backendUrl("http://app.internal/site/", "/about").href).toBe("http://app.internal/site/about");
  });
});

describe("forwardHeaders", () => {
  it("sends the Inertia headers and the configured request headers", () => {
    const headers = forwardHeaders(
      {
        request: incoming({
          headers: {
            cookie: "fe_typo_user=abc",
            "accept-language": "de",
            "user-agent": "test",
            "x-secret": "nope",
            host: "example.org",
          },
        }),
        url: publicUrl,
        backend,
        version: "v1",
        clientAddress: "203.0.113.9",
      },
      options,
    );
    expect(headers.get("x-inertia")).toBe("true");
    expect(headers.get("x-requested-with")).toBe("XMLHttpRequest");
    expect(headers.get("accept")).toBe("text/html, application/xhtml+xml");
    expect(headers.get("x-inertia-version")).toBe("v1");
    expect(headers.get("cookie")).toBe("fe_typo_user=abc");
    expect(headers.get("accept-language")).toBe("de");
    expect(headers.get("user-agent")).toBe("test");
    expect(headers.get("x-secret")).toBeNull();
    expect(headers.get("host")).toBeNull();
  });

  it("describes the public request with X-Forwarded-*", () => {
    const headers = forwardHeaders(
      {
        request: incoming({ headers: { "x-forwarded-for": "198.51.100.1" } }),
        url: publicUrl,
        backend,
        version: undefined,
        clientAddress: "203.0.113.9",
      },
      options,
    );
    expect(headers.get("x-forwarded-host")).toBe("example.org");
    expect(headers.get("x-forwarded-proto")).toBe("https");
    expect(headers.get("x-forwarded-port")).toBe("443");
    expect(headers.get("x-forwarded-for")).toBe("198.51.100.1, 203.0.113.9");
  });

  it("only sends the version on GET", () => {
    const post = forwardHeaders(
      { request: incoming({ method: "POST" }), url: publicUrl, backend, version: "v1" },
      options,
    );
    expect(post.get("x-inertia-version")).toBeNull();
    const none = forwardHeaders({ request: incoming(), url: publicUrl, backend, version: undefined }, options);
    expect(none.get("x-inertia-version")).toBeNull();
  });

  it("honours a custom header list", () => {
    const custom = resolveOptions({ forwardHeaders: ["X-Tenant"] });
    const headers = forwardHeaders(
      {
        request: incoming({ headers: { "x-tenant": "a", cookie: "c=1" } }),
        url: publicUrl,
        backend,
        version: undefined,
      },
      custom,
    );
    expect(headers.get("x-tenant")).toBe("a");
    expect(headers.get("cookie")).toBeNull();
    const extra = resolveOptions({ extraForwardHeaders: ["X-Tenant"] });
    const both = forwardHeaders(
      {
        request: incoming({ headers: { "x-tenant": "a", cookie: "c=1" } }),
        url: publicUrl,
        backend,
        version: undefined,
      },
      extra,
    );
    expect(both.get("x-tenant")).toBe("a");
    expect(both.get("cookie")).toBe("c=1");
  });
});

describe("buildBackendRequest", () => {
  it("forwards method and body, never following redirects", async () => {
    const request = buildBackendRequest(
      {
        request: incoming({
          method: "POST",
          body: "name=Ada",
          headers: { "content-type": "application/x-www-form-urlencoded" },
        }),
        url: publicUrl,
        backend,
        version: "v1",
      },
      options,
    );
    expect(request.method).toBe("POST");
    expect(request.url).toBe("http://typo3.internal/de/ueber-uns?x=1");
    expect(request.redirect).toBe("manual");
    expect(request.headers.get("content-type")).toBe("application/x-www-form-urlencoded");
    expect(await request.text()).toBe("name=Ada");
  });

  it("sends HEAD as GET", () => {
    const request = buildBackendRequest(
      { request: incoming({ method: "HEAD" }), url: publicUrl, backend, version: "v1" },
      options,
    );
    expect(request.method).toBe("GET");
  });

  it("uses an explicit path and method", () => {
    const request = buildBackendRequest(
      {
        request: incoming({ method: "POST", body: "x" }),
        url: publicUrl,
        backend,
        version: undefined,
        path: "/users",
        method: "GET",
      },
      options,
    );
    expect(request.method).toBe("GET");
    expect(request.url).toBe("http://typo3.internal/users");
    expect(request.body).toBeNull();
  });
});

function json(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: { "content-type": "application/json", "x-inertia": "true", ...(init.headers as Record<string, string>) },
  });
}

const ctx = { method: "GET", backend, url: publicUrl };

describe("classifyResponse", () => {
  it("parses a page object and keeps the status", async () => {
    const result = await classifyResponse(
      json({ component: "Error", props: {}, url: "/x", version: "1" }, { status: 404 }),
      ctx,
    );
    expect(result.kind).toBe("page");
    if (result.kind !== "page") return;
    expect(result.status).toBe(404);
    expect(result.page.props.errors).toEqual({});
  });

  it("passes HTML through", async () => {
    const result = await classifyResponse(
      new Response("<h1>x</h1>", { headers: { "content-type": "text/html" } }),
      ctx,
    );
    expect(result.kind).toBe("passthrough");
  });

  it("passes JSON without X-Inertia through", async () => {
    const result = await classifyResponse(new Response("{}", { headers: { "content-type": "application/json" } }), ctx);
    expect(result.kind).toBe("passthrough");
  });

  it("keeps a 303 after POST and a 302 after GET", async () => {
    const after = await classifyResponse(new Response(null, { status: 303, headers: { location: "/contact" } }), {
      ...ctx,
      method: "POST",
    });
    expect(after).toMatchObject({ kind: "redirect", status: 303, location: "/contact" });
    const get = await classifyResponse(new Response(null, { status: 302, headers: { location: "/a" } }), ctx);
    expect(get).toMatchObject({ kind: "redirect", status: 302 });
  });

  it.each(["PUT", "PATCH", "DELETE"])("turns a 302 after %s into a 303", async (method) => {
    const result = await classifyResponse(new Response(null, { status: 302, headers: { location: "/a" } }), {
      ...ctx,
      method,
    });
    expect(result).toMatchObject({ kind: "redirect", status: 303 });
  });

  it("rewrites a Location on the backend's origin to a path", async () => {
    const result = await classifyResponse(
      new Response(null, { status: 301, headers: { location: "http://typo3.internal/about?a=1" } }),
      ctx,
    );
    expect(result).toMatchObject({ kind: "redirect", location: "/about?a=1", status: 301 });
  });

  it("treats 409 with X-Inertia-Version as a version mismatch", async () => {
    const result = await classifyResponse(
      new Response(null, { status: 409, headers: { "x-inertia-location": publicUrl.href, "x-inertia-version": "v2" } }),
      { ...ctx, sentVersion: "v1" },
    );
    expect(result).toMatchObject({ kind: "version-mismatch", serverVersion: "v2" });
  });

  it("treats a pre-v3 409 back to the same URL as a version mismatch", async () => {
    const result = await classifyResponse(
      new Response(null, { status: 409, headers: { "x-inertia-location": "http://typo3.internal/de/ueber-uns?x=1" } }),
      { ...ctx, sentVersion: "v1" },
    );
    expect(result).toMatchObject({ kind: "version-mismatch", serverVersion: "" });
  });

  it("turns 409 + X-Inertia-Location into a 303 to an external URL", async () => {
    const result = await classifyResponse(
      new Response(null, { status: 409, headers: { "x-inertia-location": "https://pay.example.com/checkout" } }),
      ctx,
    );
    expect(result).toMatchObject({ kind: "redirect", status: 303, location: "https://pay.example.com/checkout" });
  });

  it("turns 409 + X-Inertia-Redirect into a 303 keeping the fragment", async () => {
    const result = await classifyResponse(
      new Response(null, { status: 409, headers: { "x-inertia-redirect": "/about#team" } }),
      ctx,
    );
    expect(result).toMatchObject({ kind: "redirect", status: 303, location: "/about#team" });
  });

  it("prefers X-Inertia-Redirect over X-Inertia-Location on a 409", async () => {
    const result = await classifyResponse(
      new Response(null, {
        status: 409,
        headers: { "x-inertia-redirect": "/target", "x-inertia-location": "https://pay.example.com/checkout" },
      }),
      ctx,
    );
    expect(result).toMatchObject({ kind: "redirect", status: 303, location: "/target" });
  });

  it("prefers the version mismatch over a redirect header on a 409", async () => {
    const result = await classifyResponse(
      new Response(null, { status: 409, headers: { "x-inertia-version": "v2", "x-inertia-redirect": "/target" } }),
      ctx,
    );
    expect(result).toMatchObject({ kind: "version-mismatch", serverVersion: "v2" });
  });

  it("redirects a 409 back to the same URL when no version was sent", async () => {
    const result = await classifyResponse(
      new Response(null, { status: 409, headers: { "x-inertia-location": "http://typo3.internal/de/ueber-uns?x=1" } }),
      ctx,
    );
    expect(result).toMatchObject({ kind: "redirect", status: 303, location: "/de/ueber-uns?x=1" });
  });

  it("redirects a 409 back to the same URL after a non-GET request", async () => {
    const result = await classifyResponse(
      new Response(null, { status: 409, headers: { "x-inertia-location": "http://typo3.internal/de/ueber-uns?x=1" } }),
      { ...ctx, method: "POST", sentVersion: "v1" },
    );
    expect(result).toMatchObject({ kind: "redirect", status: 303 });
  });

  it("compares a pre-v3 409 location with the requested path override", async () => {
    const response = () =>
      new Response(null, { status: 409, headers: { "x-inertia-location": "http://typo3.internal/users" } });
    const match = await classifyResponse(response(), { ...ctx, sentVersion: "v1", requestedPath: "/users" });
    expect(match).toMatchObject({ kind: "version-mismatch", serverVersion: "" });
    const other = await classifyResponse(response(), { ...ctx, sentVersion: "v1" });
    expect(other).toMatchObject({ kind: "redirect", location: "/users" });
  });

  it("falls through a 409 without Inertia headers", async () => {
    const result = await classifyResponse(new Response("conflict", { status: 409 }), ctx);
    expect(result.kind).toBe("passthrough");
  });

  it("rejects an invalid page object", async () => {
    await expect(classifyResponse(json({ props: {} }), ctx)).rejects.toThrow(/component/);
  });
});

describe("rewriteLocation", () => {
  it("leaves other origins alone", () => {
    expect(rewriteLocation("https://other.example/x", backend, publicUrl)).toBe("https://other.example/x");
  });
  it("makes the public origin relative", () => {
    expect(rewriteLocation("https://example.org/a#b", backend, publicUrl)).toBe("/a#b");
  });
  it("strips the backend base path", () => {
    expect(rewriteLocation("http://app.internal/site/a", "http://app.internal/site", publicUrl)).toBe("/a");
  });
});

describe("response headers", () => {
  it("copies cache headers and tags, all cookies, and drops X-Inertia from Vary", () => {
    const response = new Response("{}", {
      headers: [
        ["cache-control", "public, max-age=60"],
        ["x-cache-tags", "pageId_12,pageId_1"],
        ["vary", "X-Inertia, Accept-Language"],
        ["set-cookie", "a=1; Path=/"],
        ["set-cookie", "b=2; Path=/"],
        ["x-powered-by", "PHP"],
      ],
    });
    const headers = pageResponseHeaders(response, options, true);
    expect(headers.get("cache-control")).toBe("public, max-age=60");
    expect(headers.get("x-cache-tags")).toBe("pageId_12,pageId_1");
    expect(headers.get("vary")).toBe("Accept-Language, Cookie");
    expect(headers.getSetCookie()).toEqual(["a=1; Path=/", "b=2; Path=/"]);
    expect(headers.get("x-powered-by")).toBeNull();
  });

  it("rewriteVary", () => {
    expect(rewriteVary("X-Inertia", false)).toBeNull();
    expect(rewriteVary("*", true)).toBe("*");
    expect(rewriteVary(null, true)).toBe("Cookie");
  });

  it("passthrough keeps status, cookies and body, drops encoding headers", async () => {
    const response = new Response("<p>hi</p>", {
      status: 418,
      headers: [
        ["content-type", "text/html"],
        ["content-encoding", "gzip"],
        ["set-cookie", "a=1"],
        ["set-cookie", "b=2"],
        ["location", "http://typo3.internal/x"],
      ],
    });
    const out = passthrough(response, { backend, url: publicUrl });
    expect(out.status).toBe(418);
    expect(out.headers.get("content-encoding")).toBeNull();
    expect(out.headers.getSetCookie()).toEqual(["a=1", "b=2"]);
    expect(out.headers.get("location")).toBe("/x");
    expect(await out.text()).toBe("<p>hi</p>");
  });

  it("redirectResponse carries the backend's cookies", () => {
    const backendResponse = new Response(null, { status: 303, headers: [["set-cookie", "s=1"]] });
    const out = redirectResponse({ kind: "redirect", location: "/a", status: 303, response: backendResponse });
    expect(out.status).toBe(303);
    expect(out.headers.get("location")).toBe("/a");
    expect(out.headers.getSetCookie()).toEqual(["s=1"]);
  });
});

describe("forwardHeaders X-Forwarded-*", () => {
  const forward = (url: string, request: Request, clientAddress?: string) =>
    forwardHeaders({ request, url: new URL(url), backend, version: undefined, clientAddress }, options);

  it("derives the default port from the protocol and keeps an explicit one", () => {
    const http = forward("http://example.org/", incoming({ url: "http://example.org/" }));
    expect(http.get("x-forwarded-proto")).toBe("http");
    expect(http.get("x-forwarded-port")).toBe("80");
    const https = forward("https://example.org/", incoming({ url: "https://example.org/" }));
    expect(https.get("x-forwarded-port")).toBe("443");
    const custom = forward("https://example.org:8443/", incoming({ url: "https://example.org:8443/" }));
    expect(custom.get("x-forwarded-port")).toBe("8443");
  });

  it("appends the client address to a prior X-Forwarded-For, or keeps the prior one alone", () => {
    const request = incoming({ headers: { "x-forwarded-for": "10.0.0.1" } });
    expect(forward(publicUrl.href, request, "10.0.0.2").get("x-forwarded-for")).toBe("10.0.0.1, 10.0.0.2");
    expect(forward(publicUrl.href, request).get("x-forwarded-for")).toBe("10.0.0.1");
    expect(forward(publicUrl.href, incoming(), "10.0.0.2").get("x-forwarded-for")).toBe("10.0.0.2");
    expect(forward(publicUrl.href, incoming()).has("x-forwarded-for")).toBe(false);
  });

  it("only forwards configured headers that are present", () => {
    expect(forward(publicUrl.href, incoming()).has("cookie")).toBe(false);
  });
});

describe("backendUrl and rewriteLocation edge cases", () => {
  it("strips several trailing slashes of the backend base path", () => {
    expect(backendUrl("http://app.internal/site//", "/about").href).toBe("http://app.internal/site/about");
  });

  it("keeps backend paths outside the base path", () => {
    expect(rewriteLocation("http://app.internal/other/a", "http://app.internal/site", publicUrl)).toBe("/other/a");
  });

  it("only strips the base path on the backend's origin", () => {
    expect(rewriteLocation("https://example.org/site/a", "http://app.internal/site", publicUrl)).toBe("/site/a");
  });

  it("maps the base path itself to the root", () => {
    expect(rewriteLocation("http://app.internal/site", "http://app.internal/site", publicUrl)).toBe("/");
  });

  it("returns an unparseable location as is", () => {
    expect(rewriteLocation("http://[bad", backend, publicUrl)).toBe("http://[bad");
  });
});

describe("classifyResponse edge cases", () => {
  const sameUrl = { "x-inertia-location": "http://typo3.internal/de/ueber-uns?x=1" };

  it("does not read Inertia headers on a non-409 response", async () => {
    const result = await classifyResponse(new Response("ok", { status: 200, headers: sameUrl }), {
      ...ctx,
      sentVersion: "v1",
    });
    expect(result.kind).toBe("passthrough");
  });

  it("passes a 409 without Inertia headers through", async () => {
    expect((await classifyResponse(new Response(null, { status: 409 }), ctx)).kind).toBe("passthrough");
  });

  it("redirects a 409 back to the same URL when no version was sent", async () => {
    const result = await classifyResponse(new Response(null, { status: 409, headers: sameUrl }), ctx);
    expect(result).toMatchObject({ kind: "redirect", status: 303 });
  });

  it("redirects a 409 back to the same URL on a non-GET request", async () => {
    const result = await classifyResponse(new Response(null, { status: 409, headers: sameUrl }), {
      ...ctx,
      method: "POST",
      sentVersion: "v1",
    });
    expect(result).toMatchObject({ kind: "redirect", status: 303 });
  });

  it("redirects a 409 to another URL even when a version was sent", async () => {
    const result = await classifyResponse(
      new Response(null, { status: 409, headers: { "x-inertia-location": "/elsewhere" } }),
      { ...ctx, sentVersion: "v1" },
    );
    expect(result).toMatchObject({ kind: "redirect", location: "/elsewhere" });
  });

  it("compares a pre-v3 409 against the requested path override", async () => {
    const result = await classifyResponse(new Response(null, { status: 409, headers: sameUrl }), {
      ...ctx,
      sentVersion: "v1",
      requestedPath: "/other",
    });
    expect(result.kind).toBe("redirect");
  });

  it("ignores a Location header on a non-redirect status", async () => {
    const result = await classifyResponse(new Response("x", { status: 200, headers: { location: "/a" } }), ctx);
    expect(result.kind).toBe("passthrough");
  });

  it("passes a redirect status without Location through", async () => {
    expect((await classifyResponse(new Response(null, { status: 302 }), ctx)).kind).toBe("passthrough");
  });

  it("keeps a 301 after PUT", async () => {
    const result = await classifyResponse(new Response(null, { status: 301, headers: { location: "/a" } }), {
      ...ctx,
      method: "PUT",
    });
    expect(result).toMatchObject({ status: 301 });
  });

  it("passes an X-Inertia response without a JSON content type through", async () => {
    const result = await classifyResponse(
      new Response("<p>x</p>", { headers: { "x-inertia": "true", "content-type": "text/html" } }),
      ctx,
    );
    expect(result.kind).toBe("passthrough");
  });
});

describe("response header edge cases", () => {
  it("passthrough drops every hop-by-hop header and copies other headers verbatim", () => {
    const hopByHop = [
      "connection",
      "keep-alive",
      "transfer-encoding",
      "content-encoding",
      "content-length",
      "upgrade",
      "proxy-authenticate",
      "proxy-authorization",
      "te",
      "trailer",
    ];
    const response = new Response("x", {
      headers: [...hopByHop.map((name): [string, string] => [name, "1"]), ["x-link", "http://typo3.internal/x"]],
    });
    const out = passthrough(response, { backend, url: publicUrl });
    for (const name of hopByHop) expect(out.headers.has(name), name).toBe(false);
    expect(out.headers.get("x-link")).toBe("http://typo3.internal/x");
  });

  it("rewriteVary trims entries and matches Cookie case-insensitively", () => {
    expect(rewriteVary("Accept-Language ,  X-Inertia ", false)).toBe("Accept-Language");
    expect(rewriteVary("Accept, COOKIE", true)).toBe("Accept, COOKIE");
    expect(rewriteVary("Accept", false)).toBe("Accept");
  });

  it("pageResponseHeaders sets no Vary when there is nothing to send", () => {
    expect(pageResponseHeaders(new Response("{}"), options, false).has("vary")).toBe(false);
    const onlyInertia = new Response("{}", { headers: { vary: "X-Inertia" } });
    expect(pageResponseHeaders(onlyInertia, options, false).has("vary")).toBe(false);
  });

  it("pageResponseHeaders leaves Vary out when it is not a configured response header", () => {
    const custom = resolveOptions({ responseHeaders: ["cache-control"] });
    const response = new Response("{}", { headers: { vary: "Accept", "cache-control": "no-store" } });
    const headers = pageResponseHeaders(response, custom, true);
    expect(headers.has("vary")).toBe(false);
    expect(headers.get("cache-control")).toBe("no-store");
  });

  it("redirectResponse copies Cache-Control only when present", () => {
    const withCache = new Response(null, { status: 303, headers: { "cache-control": "no-store" } });
    const copied = redirectResponse({ kind: "redirect", location: "/a", status: 303, response: withCache });
    expect(copied.headers.get("cache-control")).toBe("no-store");
    const without = new Response(null, { status: 303 });
    const plain = redirectResponse({ kind: "redirect", location: "/a", status: 303, response: without });
    expect(plain.headers.has("cache-control")).toBe(false);
  });
});
