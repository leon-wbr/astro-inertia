import { describe, expect, it, vi } from "vitest";
import { fetchPartial, handle, MISMATCH_HEADER, type HandlerDeps } from "./handler.js";
import { resolveOptions, type RuntimeOptions } from "./options.js";
import { createResolver } from "./resolver.js";

const Home = () => "home";
const resolver = createResolver(
  { "/src/pages-inertia/Home.astro": () => Promise.resolve({ default: Home }) },
  "src/pages-inertia",
);

function page(body: Record<string, unknown> = {}, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify({ component: "Home", props: {}, url: "/", version: "2", ...body }), {
    ...init,
    headers: { "content-type": "application/json", "x-inertia": "true", ...(init.headers as Record<string, string>) },
  });
}

function deps(
  fetchImpl: (r: Request) => Promise<Response>,
  extra: Partial<HandlerDeps> = {},
  runtime: RuntimeOptions = {},
): HandlerDeps {
  return {
    options: resolveOptions({ backend: "http://backend.test", version: "1", timeout: 50 }),
    runtime,
    resolver,
    fetch: vi.fn(fetchImpl) as unknown as typeof fetch,
    log: { warn: vi.fn(), error: vi.fn() },
    ...extra,
  };
}

const astro = (path = "/", init: RequestInit = {}) => ({
  request: new Request(`https://public.test${path}`, init),
  url: new URL(`https://public.test${path}`),
  clientAddress: "127.0.0.1",
});

describe("handle", () => {
  it("renders the resolved component with the backend's status and headers", async () => {
    const d = deps(async () => page({}, { status: 404, headers: { "x-cache-tags": "pageId_1" } }));
    const result = await handle(astro(), d);
    expect(result.kind).toBe("render");
    if (result.kind !== "render") return;
    expect(result.Component).toBe(Home);
    expect(result.status).toBe(404);
    expect(result.headers.get("x-cache-tags")).toBe("pageId_1");
  });

  // Like inertia-laravel and inertia-typo3: a missing X-Inertia-Version header
  // counts as a mismatch too, so only the server's own version gets a page.
  const strictServer = (seen: (string | null)[]) => async (request: Request) => {
    seen.push(request.headers.get("x-inertia-version"));
    return request.headers.get("x-inertia-version") === "2"
      ? page()
      : new Response(null, { status: 409, headers: { "x-inertia-location": request.url, "x-inertia-version": "2" } });
  };

  it("reloads with the server's version on a mismatch and flags the response", async () => {
    const seen: (string | null)[] = [];
    const d = deps(strictServer(seen));
    const result = await handle(astro(), d);
    expect(seen).toEqual(["1", "2"]);
    expect(result.kind).toBe("render");
    if (result.kind === "render") expect(result.headers.get(MISMATCH_HEADER)).toBe("2");
  });

  it("adopts the server's version silently when none is configured", async () => {
    const seen: (string | null)[] = [];
    const d = deps(strictServer(seen));
    d.options.version = undefined;
    const result = await handle(astro(), d);
    expect(seen).toEqual([null, "2"]);
    expect(result.kind).toBe("render");
    if (result.kind === "render") expect(result.headers.get(MISMATCH_HEADER)).toBeNull();
    expect(d.log?.warn).not.toHaveBeenCalled();
  });

  it("fails with 502 when the server rejects its own version", async () => {
    const d = deps(async () => new Response(null, { status: 409, headers: { "x-inertia-version": "2" } }));
    const result = await handle(astro(), d);
    expect(result.kind === "response" && result.response.status).toBe(502);
  });

  it("fails with 502 on a mismatch when told to", async () => {
    const d = deps(async () => new Response(null, { status: 409, headers: { "x-inertia-version": "2" } }));
    d.options.onVersionMismatch = "error";
    const result = await handle(astro(), d);
    expect(result.kind).toBe("response");
    if (result.kind === "response") {
      expect(result.response.status).toBe(502);
      expect(await result.response.text()).toContain("version mismatch");
    }
  });

  it("lets a runtime callback answer a mismatch", async () => {
    const d = deps(
      async () => new Response(null, { status: 409, headers: { "x-inertia-version": "2" } }),
      {},
      { onVersionMismatch: () => new Response("custom", { status: 503 }) },
    );
    const result = await handle(astro(), d);
    expect(result.kind === "response" && result.response.status).toBe(503);
  });

  it("answers 504 when the backend times out", async () => {
    const d = deps(
      (request) =>
        new Promise((_, reject) => {
          request.signal.addEventListener("abort", () => reject(request.signal.reason));
        }),
    );
    const result = await handle(astro(), d);
    expect(result.kind === "response" && result.response.status).toBe(504);
  });

  it("answers 502 when the backend is unreachable", async () => {
    const d = deps(async () => {
      throw new TypeError("fetch failed");
    });
    const result = await handle(astro(), d);
    expect(result.kind === "response" && result.response.status).toBe(502);
  });

  it("answers 500 with the component list when the component is missing", async () => {
    const d = deps(async () => page({ component: "Nope" }));
    const result = await handle(astro(), d);
    expect(result.kind).toBe("response");
    if (result.kind === "response") {
      expect(result.response.status).toBe(500);
      const text = await result.response.text();
      expect(text).toContain("no component &#34;Nope&#34;");
      expect(text).toContain("Home");
    }
  });

  it("passes redirects through with cookies", async () => {
    const d = deps(
      async () =>
        new Response(null, {
          status: 303,
          headers: [
            ["location", "/contact"],
            ["set-cookie", "s=1"],
          ],
        }),
    );
    const result = await handle(astro("/contact", { method: "POST", body: "a=1" }), d);
    expect(result.kind).toBe("response");
    if (result.kind === "response") {
      expect(result.response.status).toBe(303);
      expect(result.response.headers.get("location")).toBe("/contact");
      expect(result.response.headers.getSetCookie()).toEqual(["s=1"]);
    }
  });

  it("reads the backend from INERTIA_BACKEND when not configured", async () => {
    const d = deps(async (request) => {
      expect(request.url).toBe("http://env.test/");
      return page();
    });
    d.options.backend = undefined;
    d.env = { INERTIA_BACKEND: "http://env.test" };
    expect((await handle(astro(), d)).kind).toBe("render");
  });

  it("applies transformPage", async () => {
    const d = deps(async () => page(), {}, { transformPage: (p) => ({ ...p, props: { ...p.props, added: true } }) });
    const result = await handle(astro(), d);
    expect(result.kind === "render" && result.page.props).toMatchObject({ added: true });
  });
});

describe("fetchPartial", () => {
  it("sends the partial reload headers for the page URL", async () => {
    let seen: Request | undefined;
    const d = deps(async (request) => {
      seen = request;
      return page({ props: { stats: 1 } });
    });
    const result = await fetchPartial(
      astro("/_server-islands/x"),
      d,
      { url: "/users?q=a", component: "Users/Index", version: "2" },
      ["stats", "chart"],
    );
    expect(result.props).toMatchObject({ stats: 1 });
    expect(seen?.url).toBe("http://backend.test/users?q=a");
    expect(seen?.headers.get("x-inertia-partial-component")).toBe("Users/Index");
    expect(seen?.headers.get("x-inertia-partial-data")).toBe("stats,chart");
    expect(seen?.headers.get("x-inertia-version")).toBe("2");
  });
});
