import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import type { AstroIntegration } from "astro";
import { resolveOptions, type InertiaOptions } from "./options.js";

export type {
  InertiaOptions,
  RuntimeOptions,
  ResolvedOptions,
  VersionMismatchAction,
  VersionMismatchContext,
  ComponentModule,
  AstroComponent,
} from "./options.js";
export { DEFAULT_CACHE_TAG_HEADERS, DEFAULT_FORWARD_HEADERS, DEFAULT_RESPONSE_HEADERS } from "./options.js";
export type { Page, AnyPage, Errors, OnceProp, ScrollProp } from "./protocol.js";
export { parsePage, deferredKeys, InvalidPageError, Header } from "./protocol.js";
export { definePage, errorFor } from "./define-page.js";
export type { PageName, PageProps, InertiaComponentProps, DefinedPage } from "./define-page.js";
export { ComponentNotFoundError } from "./resolver.js";

/**
 * Component name → props. Empty by default; generated types (the `types`
 * option) or your own declaration fill it in:
 *
 *   declare module "astro-inertia" {
 *     interface InertiaPages { "Users/Index": { users: User[] } }
 *   }
 */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface InertiaPages {}

const VIRTUAL_ID = "virtual:astro-inertia/config";
const RESOLVED_ID = "\0" + VIRTUAL_ID;

/** Astro integration: renders an Inertia server's pages with Astro components. */
export default function inertia(userOptions: InertiaOptions = {}): AstroIntegration {
  const options = resolveOptions(userOptions);
  let root = process.cwd();

  return {
    name: "astro-inertia",
    hooks: {
      "astro:config:setup": async ({ config, injectRoute, updateConfig, logger }) => {
        root = fileURLToPath(config.root);
        if (!config.adapter) {
          logger.warn("astro-inertia renders on demand and needs an SSR adapter, such as @astrojs/node.");
        }

        if (userOptions.types) {
          const output = userOptions.types.output ?? "src/inertia.d.ts";
          try {
            const { writeTypes } = await import("./codegen.js");
            if (await writeTypes(userOptions.types.schema, output, root)) logger.info(`Generated ${output}`);
          } catch (error) {
            logger.error(`Type generation failed: ${error instanceof Error ? error.message : String(error)}`);
            throw error;
          }
        }

        const runtimePath = userOptions.runtime ? resolve(root, userOptions.runtime) : undefined;
        const glob = `/${options.pagesDir}/**/*.astro`;

        updateConfig({
          vite: {
            // Only the config hook uses codegen; keep it out of the server bundle.
            ssr: { external: ["json-schema-to-typescript"] },
            plugins: [
              {
                name: "astro-inertia:config",
                resolveId(id) {
                  return id === VIRTUAL_ID ? RESOLVED_ID : undefined;
                },
                load(id) {
                  if (id !== RESOLVED_ID) return undefined;
                  return [
                    `export const options = ${JSON.stringify(options)};`,
                    `export const components = import.meta.glob(${JSON.stringify(glob)});`,
                    runtimePath
                      ? `import * as runtimeModule from ${JSON.stringify(runtimePath)}; export const runtime = { ...runtimeModule };`
                      : "export const runtime = {};",
                  ].join("\n");
                },
              },
            ],
          },
        });

        injectRoute({
          pattern: options.route,
          entrypoint: "astro-inertia/route.astro",
          prerender: false,
        });
      },
      "astro:config:done": ({ injectTypes }) => {
        injectTypes({
          filename: "locals.d.ts",
          content: [
            'import type { Page } from "astro-inertia";',
            "declare global {",
            "  namespace App {",
            "    interface Locals {",
            "      /** Set by astro-inertia while it renders a page component. */",
            "      inertia?: { page: Page };",
            "    }",
            "  }",
            "}",
            "export {};",
            "",
          ].join("\n"),
        });
      },
    },
  };
}
