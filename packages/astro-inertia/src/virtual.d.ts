declare module "virtual:astro-inertia/config" {
  import type { ComponentLoader, ResolvedOptions, RuntimeOptions } from "./options.js";

  export const options: ResolvedOptions;
  export const runtime: RuntimeOptions;
  export const components: Record<string, ComponentLoader>;
}
