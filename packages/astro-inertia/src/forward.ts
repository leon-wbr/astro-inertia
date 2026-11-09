import { Header, parsePage, type Page } from "./protocol.js";
import type { ResolvedOptions } from "./options.js";
import { trimTrailingSlashes } from "./paths.js";

export interface ForwardContext {
  /** The incoming request (to Astro). */
  request: Request;
  /** The public URL of the request; usually Astro.url. */
  url: URL;
  /** Base URL of the Inertia server. */
  backend: string | URL;
  /** Version to send, or undefined to send none. */
  version: string | undefined;
  /** The client IP, for X-Forwarded-For. */
  clientAddress?: string | undefined;
  /** Overrides the path and query sent to the backend (deferred props use the page URL). */
  path?: string;
  /** Extra headers, set last. */
  headers?: Record<string, string>;
  /** Overrides the method; the body is only sent when the method allows one. */
  method?: string;
}

/** The backend URL for an incoming path: the backend's base path joined with it. */
export function backendUrl(backend: string | URL, pathAndQuery: string): URL {
  const base = new URL(backend);
  const target = new URL(pathAndQuery, "http://placeholder");
  const basePath = trimTrailingSlashes(base.pathname);
  base.pathname = basePath + target.pathname;
  base.search = target.search;
  base.hash = "";
  return base;
}

/** Headers for the backend request, following the Inertia client's conventions. */
export function forwardHeaders(ctx: ForwardContext, options: Pick<ResolvedOptions, "forwardHeaders">): Headers {
  const out = new Headers();
  for (const name of options.forwardHeaders) {
    const value = ctx.request.headers.get(name);
    if (value !== null) out.set(name, value);
  }
  out.set(Header.inertia, "true");
  out.set("x-requested-with", "XMLHttpRequest");
  out.set("accept", "text/html, application/xhtml+xml");

  const method = (ctx.method ?? ctx.request.method).toUpperCase();
  if (ctx.version && method === "GET") out.set(Header.version, ctx.version);

  const proto = ctx.url.protocol.replace(/:$/, "");
  out.set("x-forwarded-host", ctx.url.host);
  out.set("x-forwarded-proto", proto);
  out.set("x-forwarded-port", ctx.url.port || (proto === "https" ? "443" : "80"));
  const prior = ctx.request.headers.get("x-forwarded-for");
  if (ctx.clientAddress) out.set("x-forwarded-for", prior ? `${prior}, ${ctx.clientAddress}` : ctx.clientAddress);
  else if (prior) out.set("x-forwarded-for", prior);

  for (const [name, value] of Object.entries(ctx.headers ?? {})) out.set(name, value);
  return out;
}

export function buildBackendRequest(
  ctx: ForwardContext,
  options: Pick<ResolvedOptions, "forwardHeaders" | "timeout">,
): Request {
  // HEAD is sent as GET: the page object is needed to render headers, and
  // the server drops the body of the answer to HEAD anyway.
  const incoming = (ctx.method ?? ctx.request.method).toUpperCase();
  const method = incoming === "HEAD" ? "GET" : incoming;
  const target = backendUrl(ctx.backend, ctx.path ?? ctx.url.pathname + ctx.url.search);
  const hasBody = method !== "GET" && method !== "HEAD" && ctx.request.body !== null;
  return new Request(target, {
    method,
    headers: forwardHeaders(ctx, options),
    redirect: "manual",
    signal: AbortSignal.timeout(options.timeout),
    ...(hasBody ? { body: ctx.request.body, duplex: "half" } : {}),
  } as RequestInit);
}

export type BackendResult =
  | { kind: "page"; page: Page; status: number; response: Response }
  | { kind: "redirect"; location: string; status: number; response: Response }
  | { kind: "version-mismatch"; serverVersion: string; location: string | null; response: Response }
  | { kind: "passthrough"; response: Response };

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

/**
 * Rewrites a Location on the backend's own origin to a path, so the
 * browser stays on the public host. Other origins are left alone.
 */
export function rewriteLocation(location: string, backend: string | URL, publicUrl: URL): string {
  let resolved: URL;
  const backendBase = new URL(backend);
  try {
    resolved = new URL(location, backendBase);
  } catch {
    return location;
  }
  if (resolved.origin === backendBase.origin || resolved.origin === publicUrl.origin) {
    const basePath = trimTrailingSlashes(backendBase.pathname);
    let path = resolved.pathname;
    if (resolved.origin === backendBase.origin && basePath && path.startsWith(basePath)) {
      path = path.slice(basePath.length) || "/";
    }
    return path + resolved.search + resolved.hash;
  }
  return resolved.href;
}

interface ClassifyContext {
  method: string;
  backend: string | URL;
  url: URL;
  sentVersion?: string | undefined;
  requestedPath?: string;
}

/**
 * Sorts a 409 into a version mismatch or a client-side redirect; undefined
 * when it carries none of the Inertia headers.
 */
function classifyConflict(response: Response, ctx: ClassifyContext, method: string): BackendResult | undefined {
  const location = response.headers.get(Header.location);
  const serverVersion = response.headers.get(Header.version);
  if (serverVersion !== null) return { kind: "version-mismatch", serverVersion, location, response };

  // Servers before protocol v3 answer a mismatch with only X-Inertia-Location,
  // pointing back at the requested URL. Redirecting there would loop.
  if (location !== null && ctx.sentVersion && method === "GET") {
    const requested = ctx.requestedPath ?? ctx.url.pathname + ctx.url.search;
    if (rewriteLocation(location, ctx.backend, ctx.url) === requested) {
      return { kind: "version-mismatch", serverVersion: "", location, response };
    }
  }

  const target = response.headers.get(Header.redirect) ?? location;
  if (target === null) return undefined;
  return { kind: "redirect", location: rewriteLocation(target, ctx.backend, ctx.url), status: 303, response };
}

/**
 * Sorts a backend response into the cases the protocol defines. Reads the
 * body only for page objects.
 */
export async function classifyResponse(response: Response, ctx: ClassifyContext): Promise<BackendResult> {
  const method = ctx.method.toUpperCase();

  if (response.status === 409) {
    const conflict = classifyConflict(response, ctx, method);
    if (conflict) return conflict;
  }

  if (REDIRECT_STATUSES.has(response.status)) {
    const location = response.headers.get("location");
    if (location !== null) {
      const status = response.status === 302 && ["PUT", "PATCH", "DELETE"].includes(method) ? 303 : response.status;
      return { kind: "redirect", location: rewriteLocation(location, ctx.backend, ctx.url), status, response };
    }
  }

  const isInertia = response.headers.get(Header.inertia)?.toLowerCase() === "true";
  const isJson = (response.headers.get("content-type") ?? "").includes("json");
  if (isInertia && isJson) {
    const page = parsePage(await response.json());
    return { kind: "page", page, status: response.status, response };
  }

  return { kind: "passthrough", response };
}

/** Hop-by-hop and encoding headers that must not be copied (fetch already decoded the body). */
const UNSAFE_HEADERS = new Set([
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
]);

/** Copies the backend response as is, minus hop-by-hop headers; rewrites a same-origin Location. */
export function passthrough(response: Response, ctx: { backend: string | URL; url: URL }): Response {
  const headers = new Headers();
  for (const [name, value] of response.headers) {
    if (UNSAFE_HEADERS.has(name) || name === "set-cookie") continue;
    headers.set(name, name === "location" ? rewriteLocation(value, ctx.backend, ctx.url) : value);
  }
  for (const cookie of response.headers.getSetCookie()) headers.append("set-cookie", cookie);
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

/** Removes X-Inertia from a Vary value; adds Cookie when cookies were forwarded. */
export function rewriteVary(vary: string | null, cookieForwarded: boolean): string | null {
  const parts = (vary ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s && s.toLowerCase() !== "x-inertia");
  if (cookieForwarded && !parts.some((p) => p.toLowerCase() === "cookie" || p === "*")) parts.push("Cookie");
  return parts.length ? parts.join(", ") : null;
}

/** Headers from a page-object response to put on the rendered HTML. */
export function pageResponseHeaders(
  response: Response,
  options: Pick<ResolvedOptions, "responseHeaders" | "cacheTagHeaders">,
  cookieForwarded: boolean,
): Headers {
  const out = new Headers();
  for (const name of [...options.responseHeaders, ...options.cacheTagHeaders]) {
    if (name === "vary") continue;
    const value = response.headers.get(name);
    if (value !== null) out.set(name, value);
  }
  if (options.responseHeaders.includes("vary")) {
    const vary = rewriteVary(response.headers.get("vary"), cookieForwarded);
    if (vary) out.set("vary", vary);
  }
  for (const cookie of response.headers.getSetCookie()) out.append("set-cookie", cookie);
  return out;
}

export function redirectResponse(result: Extract<BackendResult, { kind: "redirect" }>): Response {
  const headers = new Headers({ location: result.location });
  for (const cookie of result.response.headers.getSetCookie()) headers.append("set-cookie", cookie);
  const cacheControl = result.response.headers.get("cache-control");
  if (cacheControl) headers.set("cache-control", cacheControl);
  return new Response(null, { status: result.status, headers });
}
