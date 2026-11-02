import type { AstroComponent, ComponentLoader, ComponentModule, RuntimeOptions } from "./options.js";

export class ComponentNotFoundError extends Error {
  override name = "ComponentNotFoundError";
  constructor(
    readonly component: string,
    readonly searched: string[],
    readonly pagesDir: string,
  ) {
    super(
      `astro-inertia: no component "${component}". Expected ${pagesDir}/${component}.astro` +
        (searched.length ? `; found ${searched.length} components` : `; ${pagesDir} has no .astro files`) +
        ", or return it from resolve() in the runtime module.",
    );
  }
}

/** "Users/Index" for "/src/pages-inertia/Users/Index.astro". */
export function componentName(file: string, pagesDir: string): string | undefined {
  const normalized = file.replace(/\\/g, "/").replace(/^\.?\//, "");
  const prefix = pagesDir.replace(/^\.?\/+|\/+$/g, "") + "/";
  const index = normalized.indexOf(prefix);
  if (index === -1) return undefined;
  const rest = normalized.slice(index + prefix.length);
  if (!rest.endsWith(".astro")) return undefined;
  return rest.slice(0, -".astro".length);
}

/**
 * Normalises a component name: no leading or trailing slashes, no "..",
 * and "." in names like "Users.Index" accepted as a separator.
 */
export function normalizeName(name: string): string | undefined {
  const cleaned = name.trim().replace(/^\/+|\/+$/g, "");
  if (!cleaned || cleaned.split("/").some((seg) => seg === ".." || seg === ".")) return undefined;
  return cleaned;
}

function toComponent(value: ComponentModule | AstroComponent): AstroComponent {
  return typeof value === "function" ? value : value.default;
}

export interface Resolver {
  resolve(name: string): Promise<AstroComponent>;
  names(): string[];
}

export function createResolver(
  glob: Record<string, ComponentLoader>,
  pagesDir: string,
  custom?: RuntimeOptions["resolve"],
): Resolver {
  const byName = new Map<string, ComponentLoader>();
  for (const [file, loader] of Object.entries(glob)) {
    const name = componentName(file, pagesDir);
    if (name !== undefined) byName.set(name, loader);
  }

  return {
    names: () => [...byName.keys()].sort(),
    async resolve(rawName) {
      const name = normalizeName(rawName);
      if (name !== undefined && custom) {
        const found = await custom(name);
        if (found) return toComponent(found);
      }
      const loader =
        name === undefined
          ? undefined
          : (byName.get(name) ?? byName.get(name.replace(/\./g, "/")) ?? byName.get(`${name}/index`));
      if (!loader) throw new ComponentNotFoundError(rawName, [...byName.keys()], pagesDir);
      return toComponent(await loader());
    },
  };
}
