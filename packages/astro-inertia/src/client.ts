import type { Page } from "./protocol.js";

/**
 * Reads the page object that <InertiaPageData /> rendered, in the browser.
 * Returns undefined when the element is missing.
 */
export function getPage<Props extends object = Record<string, unknown>>(id = "app"): Page<Props> | undefined {
  const element = document.querySelector<HTMLScriptElement>(
    `script[type="application/json"][data-page="${CSS.escape(id)}"]`,
  );
  if (!element?.textContent) return undefined;
  return JSON.parse(element.textContent) as Page<Props>;
}
