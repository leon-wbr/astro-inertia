import { trimSlashes } from "./paths.js";
import type { Page } from "./protocol.js";

export type VersionMismatchAction = "reload" | "error";

export interface VersionMismatchContext {
  request: Request;
  clientVersion: string;
  serverVersion: string;
}

/** Options that survive serialisation into the build (astro.config). */
export interface InertiaOptions {
  /**
   * Base URL of the Inertia server, e.g. "http://typo3.internal". When
   * omitted, the INERTIA_BACKEND environment variable is read at request
   * time.
   */
  backend?: string;
  /** Asset version or schema hash this frontend was built for. */
  version?: string;
  /** What to do when the server answers 409 with a different version. Default "reload". */
  onVersionMismatch?: VersionMismatchAction;
  /** Backend request timeout in milliseconds. Default 10000. */
  timeout?: number;
  /** Request headers copied to the backend, lower case. Replaces the default list. */
  forwardHeaders?: string[];
  /** Extra request headers to copy, added to the default list. */
  extraForwardHeaders?: string[];
  /** Response headers copied from a page object response onto the rendered HTML. */
  responseHeaders?: string[];
  /** Cache-tag headers copied from the backend. */
  cacheTagHeaders?: string[];
  /** Directory of Inertia page components, relative to the project root. Default "src/pages-inertia". */
  pagesDir?: string;
  /** Route pattern of the injected catch-all. Default "/[...inertia]". */
  route?: string;
  /**
   * Module (path relative to the project root) whose exports override
   * options at runtime with functions: `resolve`, `backend`, `version`,
   * `onVersionMismatch`. See RuntimeOptions.
   */
  runtime?: string;
  /** Type generation from a JSON Schema. */
  types?: {
    /** Path (relative to the project root) or http(s) URL of the schema. */
    schema: string;
    /** Output file, relative to the project root. Default "src/inertia.d.ts". */
    output?: string;
  };
}

// The module type is loose on purpose: an .astro component's default export.
export type AstroComponent = (...args: never[]) => unknown;
export type ComponentModule = { default: AstroComponent };
export type ComponentLoader = () => Promise<ComponentModule>;

/** Functions that can only be provided through the `runtime` module. */
export interface RuntimeOptions {
  /** Resolves a component name. Return undefined to fall back to the pagesDir glob. */
  resolve?: (
    name: string,
  ) => ComponentModule | AstroComponent | undefined | Promise<ComponentModule | AstroComponent | undefined>;
  backend?: (request: Request) => string | URL;
  version?: (request: Request) => string | undefined;
  onVersionMismatch?: (
    ctx: VersionMismatchContext,
  ) => VersionMismatchAction | Response | Promise<VersionMismatchAction | Response>;
  /** Called with every page object before rendering, e.g. to log or adjust it. */
  transformPage?: (page: Page, request: Request) => Page | Promise<Page>;
}

export const DEFAULT_FORWARD_HEADERS = [
  "accept-language",
  "authorization",
  "content-type",
  "cookie",
  "origin",
  "referer",
  "user-agent",
  "x-xsrf-token",
  "x-csrf-token",
  // Inertia request headers a browser-side caller may send (partial reloads).
  "x-inertia-partial-component",
  "x-inertia-partial-data",
  "x-inertia-partial-except",
  "x-inertia-reset",
  "x-inertia-error-bag",
  "purpose",
];

export const DEFAULT_RESPONSE_HEADERS = ["cache-control", "expires", "vary", "content-language", "x-robots-tag"];

export const DEFAULT_CACHE_TAG_HEADERS = ["x-cache-tags", "cache-tag", "surrogate-key", "xkey"];

export interface ResolvedOptions {
  backend: string | undefined;
  version: string | undefined;
  onVersionMismatch: VersionMismatchAction;
  timeout: number;
  forwardHeaders: string[];
  responseHeaders: string[];
  cacheTagHeaders: string[];
  pagesDir: string;
  route: string;
}

export function resolveOptions(options: InertiaOptions = {}): ResolvedOptions {
  const lower = (list: string[]) => list.map((h) => h.toLowerCase());
  return {
    backend: options.backend,
    version: options.version,
    onVersionMismatch: options.onVersionMismatch ?? "reload",
    timeout: options.timeout ?? 10_000,
    forwardHeaders: lower([
      ...(options.forwardHeaders ?? DEFAULT_FORWARD_HEADERS),
      ...(options.extraForwardHeaders ?? []),
    ]),
    responseHeaders: lower(options.responseHeaders ?? DEFAULT_RESPONSE_HEADERS),
    cacheTagHeaders: lower(options.cacheTagHeaders ?? DEFAULT_CACHE_TAG_HEADERS),
    pagesDir: trimSlashes(options.pagesDir ?? "src/pages-inertia"),
    route: options.route ?? "/[...inertia]",
  };
}
