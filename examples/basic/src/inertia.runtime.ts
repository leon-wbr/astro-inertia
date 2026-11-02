import type { RuntimeOptions } from "astro-inertia";

/** Aliases: the backend may call the start page "Welcome". */
export const resolve: RuntimeOptions["resolve"] = (name) =>
  name === "Welcome" ? import("./pages-inertia/Home.astro") : undefined;
