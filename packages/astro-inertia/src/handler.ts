import {
  buildBackendRequest,
  classifyResponse,
  pageResponseHeaders,
  passthrough,
  redirectResponse,
  type BackendResult,
} from "./forward.js";
import type { AstroComponent, ResolvedOptions, RuntimeOptions } from "./options.js";
import { Header, type Page } from "./protocol.js";
import { ComponentNotFoundError, type Resolver } from "./resolver.js";

export const MISMATCH_HEADER = "x-astro-inertia-version-mismatch";

export interface AstroLike {
  request: Request;
  url: URL;
  clientAddress?: string | undefined;
}

export interface HandlerDeps {
  options: ResolvedOptions;
  runtime: RuntimeOptions;
  resolver: Resolver;
  fetch?: typeof fetch;
  env?: Record<string, string | undefined>;
  log?: Pick<Console, "warn" | "error">;
  /** Server versions already warned about; one per process in production. */
  warned?: Set<string>;
}

export type HandleResult =
  | { kind: "response"; response: Response }
  | { kind: "render"; Component: AstroComponent; page: Page; status: number; headers: Headers };

export class BackendError extends Error {
  override name = "BackendError";
  constructor(
    message: string,
    readonly status: number,
    options?: ErrorOptions,
  ) {
    super(message, options);
  }
}

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

export function errorResponse(status: number, title: string, detail: string): Response {
  const body = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${escapeHtml(title)}</title></head><body><h1>${escapeHtml(title)}</h1><pre>${escapeHtml(detail)}</pre></body></html>`;
  return new Response(body, {
    status,
    headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
  });
}

export function backendFor(request: Request, deps: Pick<HandlerDeps, "options" | "runtime" | "env">): string | URL {
  const backend = deps.runtime.backend?.(request) ?? deps.options.backend ?? (deps.env ?? process.env).INERTIA_BACKEND;
  if (!backend) {
    throw new BackendError(
      "astro-inertia: no backend configured. Set `backend` in the integration options or the INERTIA_BACKEND environment variable.",
      500,
    );
  }
  return backend;
}

function warnOnce(deps: HandlerDeps, clientVersion: string | undefined, serverVersion: string): void {
  const warned = (deps.warned ??= new Set());
  if (warned.has(serverVersion)) return;
  warned.add(serverVersion);
  (deps.log ?? console).warn(
    `astro-inertia: version mismatch (frontend "${clientVersion}", server "${serverVersion}"); rendering with the server's version.`,
  );
}

/** Sends one request to the backend and sorts the answer. */
export async function fetchBackend(
  astro: AstroLike,
  deps: HandlerDeps,
  init: { path?: string; headers?: Record<string, string>; method?: string; version?: string | undefined },
): Promise<BackendResult> {
  const backend = backendFor(astro.request, deps);
  const request = buildBackendRequest(
    {
      request: astro.request,
      url: astro.url,
      backend,
      version: init.version,
      clientAddress: astro.clientAddress,
      ...(init.path !== undefined ? { path: init.path } : {}),
      ...(init.headers ? { headers: init.headers } : {}),
      ...(init.method ? { method: init.method } : {}),
    },
    deps.options,
  );
  let response: Response;
  try {
    response = await (deps.fetch ?? fetch)(request);
  } catch (error) {
    const timedOut = error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");
    throw new BackendError(
      timedOut
        ? `astro-inertia: ${request.method} ${request.url} timed out after ${deps.options.timeout} ms`
        : `astro-inertia: ${request.method} ${request.url} failed: ${error instanceof Error ? error.message : String(error)}`,
      timedOut ? 504 : 502,
      { cause: error },
    );
  }
  return classifyResponse(response, {
    method: request.method,
    backend,
    url: astro.url,
    sentVersion: init.version,
    requestedPath: init.path ?? astro.url.pathname + astro.url.search,
  });
}

/** Forwards the request, then turns the answer into a response or a component to render. */
export async function handle(astro: AstroLike, deps: HandlerDeps): Promise<HandleResult> {
  try {
    return await handleInner(astro, deps);
  } catch (error) {
    if (error instanceof ComponentNotFoundError) {
      const available = deps.resolver.names();
      return {
        kind: "response",
        response: errorResponse(
          500,
          "Inertia component not found",
          `${error.message}\n\nAvailable components:\n${available.map((n) => `  ${n}`).join("\n") || "  (none)"}`,
        ),
      };
    }
    if (error instanceof BackendError) {
      (deps.log ?? console).error(error.message);
      return {
        kind: "response",
        response: errorResponse(error.status, error.status === 504 ? "Gateway Timeout" : "Bad Gateway", error.message),
      };
    }
    if (error instanceof Error && error.name === "InvalidPageError") {
      return { kind: "response", response: errorResponse(502, "Invalid Inertia response", error.message) };
    }
    throw error;
  }
}

async function handleInner(astro: AstroLike, deps: HandlerDeps): Promise<HandleResult> {
  const backend = backendFor(astro.request, deps);
  const version = deps.runtime.version?.(astro.request) ?? deps.options.version;
  let result = await fetchBackend(astro, deps, { version });
  let mismatch: string | undefined;

  if (result.kind === "version-mismatch" && version === undefined) {
    // No version configured: this frontend isn't tied to the server's assets,
    // so take the server's version. Servers like inertia-laravel and
    // inertia-typo3 treat a missing header as a mismatch too.
    result = await fetchBackend(astro, deps, { version: result.serverVersion });
    if (result.kind === "version-mismatch") {
      throw new BackendError("astro-inertia: the server answered 409 to its own version", 502);
    }
  }

  if (result.kind === "version-mismatch") {
    const serverVersion = result.serverVersion;
    const action =
      (await deps.runtime.onVersionMismatch?.({
        request: astro.request,
        clientVersion: version ?? "",
        serverVersion,
      })) ?? deps.options.onVersionMismatch;
    if (action instanceof Response) return { kind: "response", response: action };
    if (action === "error") {
      return {
        kind: "response",
        response: errorResponse(
          502,
          "Inertia version mismatch",
          `astro-inertia: this frontend was built for version "${version}", the server is on "${serverVersion}".`,
        ),
      };
    }
    warnOnce(deps, version, serverVersion);
    mismatch = serverVersion || "unknown";
    result = await fetchBackend(astro, deps, { version: serverVersion || undefined });
    if (result.kind === "version-mismatch") {
      throw new BackendError("astro-inertia: the server answered 409 to its own version", 502);
    }
  }

  switch (result.kind) {
    case "redirect":
      return { kind: "response", response: redirectResponse(result) };
    case "passthrough":
      return { kind: "response", response: passthrough(result.response, { backend, url: astro.url }) };
    case "page": {
      const page = deps.runtime.transformPage
        ? await deps.runtime.transformPage(result.page, astro.request)
        : result.page;
      const Component = await deps.resolver.resolve(page.component);
      const headers = pageResponseHeaders(result.response, deps.options, astro.request.headers.has("cookie"));
      if (mismatch !== undefined) headers.set(MISMATCH_HEADER, mismatch);
      return { kind: "render", Component, page, status: result.status, headers };
    }
  }
}

/**
 * A partial reload for deferred props: the page's URL with
 * X-Inertia-Partial-Component and X-Inertia-Partial-Data.
 */
export async function fetchPartial(
  astro: AstroLike,
  deps: HandlerDeps,
  page: { url: string; component: string; version?: string | null },
  keys: string[],
): Promise<Page> {
  const request = (version: string | undefined) =>
    fetchBackend(astro, deps, {
      path: page.url,
      method: "GET",
      version,
      headers: { [Header.partialComponent]: page.component, [Header.partialData]: keys.join(",") },
    });

  let result = await request(page.version ?? undefined);
  if (result.kind === "version-mismatch") result = await request(undefined);
  if (result.kind !== "page") {
    throw new BackendError(`astro-inertia: partial reload of ${page.url} answered with a ${result.kind}`, 502);
  }
  return result.page;
}

export interface DeferredRequest {
  page: { url: string; component: string; version?: string | null };
  keys: string[];
  /** Component to render once the keys are there. */
  render: string;
  /** Component to render when loading fails. */
  error?: string | undefined;
}

export type DeferredResult =
  { kind: "loaded"; Component: AstroComponent; page: Page } | { kind: "failed"; Component: AstroComponent | undefined };

/**
 * Loads the props of a deferred island. Any failure (backend, missing or
 * rescued keys, unresolvable component) is logged and yields the error
 * component, or none if that cannot be resolved either.
 */
export async function loadDeferred(astro: AstroLike, deps: HandlerDeps, req: DeferredRequest): Promise<DeferredResult> {
  try {
    const page = await fetchPartial(astro, deps, req.page, req.keys);
    const missing = req.keys.filter((key) => !(key in page.props) || page.rescuedProps?.includes(key));
    if (missing.length > 0) {
      throw new BackendError(`astro-inertia: deferred props missing from the response: ${missing.join(", ")}`, 502);
    }
    return { kind: "loaded", Component: await deps.resolver.resolve(req.render), page };
  } catch (failure) {
    (deps.log ?? console).error(failure);
    const Component = req.error ? await deps.resolver.resolve(req.error).catch(() => undefined) : undefined;
    return { kind: "failed", Component };
  }
}
