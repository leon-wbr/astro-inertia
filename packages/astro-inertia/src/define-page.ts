import type { InertiaPages } from "./index.js";
import type { Errors, Page } from "./protocol.js";

export type PageName = keyof InertiaPages & string;

type PropsOf<T> = T extends PageName ? InertiaPages[T] : T extends object ? T : never;

export type PageProps<T> = PropsOf<T> & { errors: Errors };

/** The props an Inertia page component receives: the page's props plus `page`. */
export type InertiaComponentProps<T = Record<string, unknown>> = PageProps<T> & { page: Page<PropsOf<T>> };

export interface DefinedPage<T> {
  /** The page's props, with `errors` always present. */
  props: PageProps<T>;
  /** The whole page object. */
  page: Page<PropsOf<T>>;
}

/**
 * Types an Inertia page component's props. Pass the props type, or with
 * generated types a component name:
 *
 *   const { props } = definePage<{ users: User[] }>(Astro);
 *   const { props } = definePage<"Users/Index">(Astro);
 */
export function definePage<T extends object | PageName = Record<string, unknown>>(astro: {
  props: Record<string, unknown>;
}): DefinedPage<T> {
  const { page, ...props } = astro.props as { page?: Page<PropsOf<T>> } & Record<string, unknown>;
  if (!page) {
    throw new Error("astro-inertia: definePage() used outside an Inertia page component (no `page` prop)");
  }
  return { props: { errors: {}, ...props } as PageProps<T>, page };
}

/** The first message for a field, whether the server sent a string or a list. */
export function errorFor(errors: Errors | undefined, field: string): string | undefined {
  const value = errors?.[field];
  return Array.isArray(value) ? value[0] : value;
}
