/**
 * Inertia protocol v3: the page object and header names.
 * https://inertiajs.com/the-protocol
 */

export const Header = {
  inertia: "x-inertia",
  version: "x-inertia-version",
  location: "x-inertia-location",
  redirect: "x-inertia-redirect",
  partialComponent: "x-inertia-partial-component",
  partialData: "x-inertia-partial-data",
  partialExcept: "x-inertia-partial-except",
  reset: "x-inertia-reset",
  errorBag: "x-inertia-error-bag",
  exceptOnceProps: "x-inertia-except-once-props",
} as const;

export type Errors = Record<string, string | string[]>;

export interface OnceProp {
  prop: string;
  expiresAt: number | null;
}

export interface ScrollProp {
  pageName?: string;
  previousPage?: number | string | null;
  nextPage?: number | string | null;
  currentPage?: number | string | null;
  reset?: boolean;
}

/** The page object an Inertia server returns. */
export interface Page<Props extends object = Record<string, unknown>> {
  component: string;
  props: Props & { errors: Errors };
  url: string;
  version: string | null;
  encryptHistory?: boolean;
  clearHistory?: boolean;
  preserveFragment?: boolean;
  preserveBigIntegers?: boolean;
  mergeProps?: string[];
  prependProps?: string[];
  deepMergeProps?: string[];
  matchPropsOn?: string[];
  scrollProps?: Record<string, ScrollProp>;
  deferredProps?: Record<string, string[]>;
  rescuedProps?: string[];
  sharedProps?: string[];
  onceProps?: Record<string, OnceProp>;
  liveProps?: Record<string, unknown>;
  flash?: Record<string, unknown>;
}

/** Any page object, whatever its props; for layouts and helpers shared by pages. */
export type AnyPage = Page<object>;

export class InvalidPageError extends Error {
  override name = "InvalidPageError";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringArray(value: unknown, field: string): string[] | undefined {
  if (value === undefined || value === null) return undefined;
  if (!Array.isArray(value) || value.some((v) => typeof v !== "string")) {
    throw new InvalidPageError(`page.${field} must be an array of strings`);
  }
  return value as string[];
}

/**
 * Validates a decoded page object. Required: component (non-empty string),
 * props (object), url (string). `version` may be a string, a number or
 * null. Optional v3 fields are checked for shape and passed through.
 */
export function parsePage(input: unknown): Page {
  if (!isRecord(input)) throw new InvalidPageError("page object must be a JSON object");
  const { component, props, url, version } = input;
  if (typeof component !== "string" || component === "") {
    throw new InvalidPageError("page.component must be a non-empty string");
  }
  if (!isRecord(props)) throw new InvalidPageError("page.props must be an object");
  if (typeof url !== "string") throw new InvalidPageError("page.url must be a string");
  if (version !== undefined && version !== null && typeof version !== "string" && typeof version !== "number") {
    throw new InvalidPageError("page.version must be a string, a number or null");
  }

  const errors = props.errors;
  if (errors !== undefined && !isRecord(errors)) {
    throw new InvalidPageError("page.props.errors must be an object");
  }

  const page: Page = {
    ...(input as Partial<Page>),
    component,
    props: { ...props, errors: (errors as Errors | undefined) ?? {} },
    url,
    version: version === undefined || version === null ? null : String(version),
  };

  for (const field of [
    "mergeProps",
    "prependProps",
    "deepMergeProps",
    "matchPropsOn",
    "rescuedProps",
    "sharedProps",
  ] as const) {
    const value = stringArray(input[field], field);
    if (value === undefined) delete page[field];
    else page[field] = value;
  }

  if (input.deferredProps !== undefined) {
    if (!isRecord(input.deferredProps)) throw new InvalidPageError("page.deferredProps must be an object");
    for (const [group, keys] of Object.entries(input.deferredProps)) {
      stringArray(keys, `deferredProps.${group}`);
    }
  }

  return page;
}

/** Keys a deferred group (or a list of keys) stands for. */
export function deferredKeys(page: Pick<Page, "deferredProps">, data: string | string[]): string[] {
  const names = Array.isArray(data)
    ? data
    : data
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
  return names.flatMap((name) => page.deferredProps?.[name] ?? [name]);
}
