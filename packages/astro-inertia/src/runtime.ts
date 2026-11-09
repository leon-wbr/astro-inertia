/**
 * Runtime entry, imported by the injected route and the components. It
 * wires the build-time options from the virtual module into the handler.
 */
import { components, options, runtime } from "virtual:astro-inertia/config";
import {
  fetchPartial,
  handle,
  loadDeferred,
  type AstroLike,
  type DeferredRequest,
  type DeferredResult,
  type HandleResult,
  type HandlerDeps,
} from "./handler.js";
import type { Page } from "./protocol.js";
import { createResolver } from "./resolver.js";

const resolver = createResolver(components, options.pagesDir, runtime.resolve);

export const deps: HandlerDeps = { options, runtime, resolver, warned: new Set() };

/** What the runtime needs from Astro's global, or from the context passed to an endpoint. */
type AstroContext = { request: Request; url: URL; clientAddress?: string };

function astroLike(astro: AstroContext): AstroLike {
  let clientAddress: string | undefined;
  try {
    clientAddress = astro.clientAddress;
  } catch {
    clientAddress = undefined;
  }
  return { request: astro.request, url: astro.url, clientAddress };
}

export function handleRequest(astro: AstroContext): Promise<HandleResult> {
  return handle(astroLike(astro), deps);
}

export function loadPartial(
  astro: AstroContext,
  page: { url: string; component: string; version?: string | null },
  keys: string[],
): Promise<Page> {
  return fetchPartial(astroLike(astro), deps, page, keys);
}

export function loadDeferredIsland(
  astro: { request: Request; url: URL; clientAddress?: string },
  req: DeferredRequest,
): Promise<DeferredResult> {
  return loadDeferred(astroLike(astro), deps, req);
}

export const resolveComponent = (name: string) => resolver.resolve(name);
