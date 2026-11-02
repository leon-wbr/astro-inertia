/**
 * A small Inertia v3 server for tests: sessions in memory, validation
 * errors flashed through the session, deferred and partial props, asset
 * versioning with 409, redirects and an HTML (non-Inertia) page.
 *
 * Run: node tests/mock-server/server.ts [port]
 */
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { randomUUID } from "node:crypto";

type Props = Record<string, unknown>;

interface Session {
  errors?: Record<string, string>;
  old?: Record<string, string>;
  flash?: Record<string, string>;
  messages: { name: string; email: string }[];
}

interface Deferred {
  group: string;
  resolve: () => unknown | Promise<unknown>;
}

const sessions = new Map<string, Session>();
const DEFAULT_VERSION = "1";

function deferred(resolve: Deferred["resolve"], group = "default"): Deferred {
  return { group, resolve };
}
function isDeferred(value: unknown): value is Deferred {
  return typeof value === "object" && value !== null && "resolve" in value && "group" in value;
}

function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of (header ?? "").split(";")) {
    const [name, ...rest] = part.trim().split("=");
    if (name) out[name] = decodeURIComponent(rest.join("="));
  }
  return out;
}

/** Parses URL-encoded and multipart bodies, as a framework would. */
async function readForm(req: IncomingMessage): Promise<FormData> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  const request = new Request("http://mock/", {
    method: "POST",
    headers: { "content-type": req.headers["content-type"] ?? "application/x-www-form-urlencoded" },
    body: Buffer.concat(chunks),
  });
  return request.formData();
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface Ctx {
  req: IncomingMessage;
  res: ServerResponse;
  url: URL;
  session: Session;
  version: string;
  isInertia: boolean;
  setCookies: string[];
}

function html(ctx: Ctx, status: number, body: string): void {
  ctx.res.writeHead(status, { "content-type": "text/html; charset=utf-8", "set-cookie": ctx.setCookies });
  ctx.res.end(body);
}

function redirect(ctx: Ctx, status: number, location: string): void {
  ctx.res.writeHead(status, { location, "set-cookie": ctx.setCookies });
  ctx.res.end();
}

/** Renders a page object, honouring partial reloads and deferred props. */
async function render(
  ctx: Ctx,
  component: string,
  props: Props,
  status = 200,
  extraHeaders: Record<string, string> = {},
): Promise<void> {
  const { req, url, session } = ctx;
  const errors = session.errors ?? {};
  const flash = session.flash;
  delete session.errors;
  delete session.flash;
  const shared: Props = {
    app: { name: "Mock Inertia" },
    errors,
    flash: flash ?? null,
  };

  const all: Props = { ...shared, ...props };
  const partialComponent = req.headers["x-inertia-partial-component"];
  const partial = partialComponent === component;
  const only = partial
    ? String(req.headers["x-inertia-partial-data"] ?? "")
        .split(",")
        .filter(Boolean)
    : [];
  const except = partial
    ? String(req.headers["x-inertia-partial-except"] ?? "")
        .split(",")
        .filter(Boolean)
    : [];

  const out: Props = {};
  const deferredProps: Record<string, string[]> = {};
  for (const [key, value] of Object.entries(all)) {
    const always = key === "errors";
    if (partial && !always) {
      if (only.length && !only.includes(key)) continue;
      if (except.includes(key)) continue;
    }
    if (isDeferred(value)) {
      if (!partial) {
        (deferredProps[value.group] ??= []).push(key);
        continue;
      }
      out[key] = await value.resolve();
    } else {
      out[key] = value;
    }
  }

  const page: Props = { component, props: out, url: url.pathname + url.search, version: ctx.version };
  if (Object.keys(deferredProps).length) page.deferredProps = deferredProps;
  if (component === "Users/Index") page.mergeProps = ["users"];

  if (!ctx.isInertia) {
    const json = JSON.stringify(page).replace(/\//g, "\\/").replace(/</g, "\\u003C");
    html(
      ctx,
      status,
      `<!doctype html><html><head><title>${component}</title></head><body><script type="application/json" data-page="app">${json}</script><div id="app"></div></body></html>`,
    );
    return;
  }

  ctx.res.writeHead(status, {
    "content-type": "application/json",
    "x-inertia": "true",
    vary: "X-Inertia",
    "set-cookie": ctx.setCookies,
    ...extraHeaders,
  });
  ctx.res.end(JSON.stringify(page));
}

const USERS = [
  { id: 1, name: "Ada Lovelace" },
  { id: 2, name: "Grace Hopper" },
  { id: 3, name: "Margaret Hamilton" },
];

async function route(ctx: Ctx): Promise<void> {
  const { req, url, session } = ctx;
  const method = req.method ?? "GET";

  // Asset versioning: only GET Inertia requests are checked. Like
  // inertia-laravel and inertia-typo3, a missing header is a mismatch too.
  const clientVersion = req.headers["x-inertia-version"] ?? "";
  if (ctx.isInertia && method === "GET" && clientVersion !== ctx.version) {
    ctx.res.writeHead(409, { "x-inertia-location": url.href, "x-inertia-version": ctx.version });
    ctx.res.end();
    return;
  }

  switch (`${method} ${url.pathname}`) {
    case "GET /":
      return render(ctx, "Home", {
        title: "Welcome",
        intro: "Rendered by Astro from an Inertia page object.",
        links: [
          { href: "/about", label: "About" },
          { href: "/users", label: "Users" },
          { href: "/contact", label: "Contact" },
        ],
      });
    case "GET /about":
      return render(ctx, "About", { title: "About us", body: "We serve page objects." }, 200, {
        "cache-control": "public, max-age=60",
        "x-cache-tags": "pageId_2,pageId_1",
        vary: "X-Inertia, Accept-Language",
      });
    case "GET /users":
      return render(ctx, "Users/Index", {
        title: "Users",
        users: USERS,
        stats: deferred(async () => {
          await sleep(Number(url.searchParams.get("delay") ?? 400));
          return { total: USERS.length, active: 2 };
        }),
        activity: deferred(async () => ["Ada signed in"], "sidebar"),
      });
    case "GET /contact":
      return render(ctx, "Contact/Form", {
        title: "Contact",
        old: session.old ?? {},
        messages: session.messages,
        csrfToken: "mock-token",
      });
    case "POST /contact": {
      const form = await readForm(req);
      const name = String(form.get("name") ?? "").trim();
      const email = String(form.get("email") ?? "").trim();
      const errors: Record<string, string> = {};
      if (form.get("_token") !== "mock-token") errors.form = "The form expired, please try again.";
      if (!name) errors.name = "The name field is required.";
      if (!email.includes("@")) errors.email = "The email must be a valid email address.";
      if (Object.keys(errors).length) {
        session.errors = errors;
        session.old = { name, email };
        return redirect(ctx, 303, "/contact");
      }
      session.messages.push({ name, email });
      session.old = {};
      session.flash = { success: `Thanks, ${name}!` };
      return redirect(ctx, 303, "/contact");
    }
    case "GET /legacy":
      return html(
        ctx,
        200,
        '<!doctype html><html><head><title>Legacy</title></head><body><h1 id="legacy">A plain HTML page</h1></body></html>',
      );
    case "GET /missing":
      return render(ctx, "Missing/Page", { title: "Nobody renders me" });
    case "GET /external":
      ctx.res.writeHead(409, { "x-inertia-location": "https://example.com/elsewhere" });
      ctx.res.end();
      return;
    case "GET /fragment":
      ctx.res.writeHead(409, { "x-inertia-redirect": "/about#team" });
      ctx.res.end();
      return;
    case "GET /old-about":
      // An absolute redirect on the backend's own origin.
      return redirect(ctx, 301, `http://${req.headers.host}/about`);
    case "GET /__echo":
      return render(ctx, "Debug/Echo", { headers: req.headers });
    case "GET /slow":
      await sleep(Number(url.searchParams.get("ms") ?? 3000));
      return render(ctx, "Home", { title: "Slow", intro: "", links: [] });
    case "GET /health":
      ctx.res.writeHead(200, { "content-type": "text/plain" });
      ctx.res.end("ok");
      return;
    default:
      return render(ctx, "Error", { status: 404, message: `No page at ${url.pathname}` }, 404);
  }
}

export function createMockServer() {
  return createServer((req, res) => {
    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
    const cookies = parseCookies(req.headers.cookie);
    const setCookies: string[] = [];
    let sid = cookies.mock_session;
    if (!sid || !sessions.has(sid)) {
      sid = randomUUID();
      sessions.set(sid, { messages: [] });
      setCookies.push(`mock_session=${sid}; Path=/; HttpOnly; SameSite=Lax`);
    }
    const ctx: Ctx = {
      req,
      res,
      url,
      session: sessions.get(sid)!,
      // Tests change the server's version per browser through a cookie.
      version: cookies.mock_version ?? DEFAULT_VERSION,
      isInertia: req.headers["x-inertia"] === "true",
      setCookies,
    };
    route(ctx).catch((error: unknown) => {
      console.error(error);
      if (!res.headersSent) res.writeHead(500, { "content-type": "text/plain" });
      res.end("mock server error");
    });
  });
}

if (import.meta.main) {
  const port = Number(process.argv[2] ?? process.env.PORT ?? 4610);
  createMockServer().listen(port, "127.0.0.1", () => {
    console.log(`mock inertia server on http://127.0.0.1:${port}`);
  });
}
