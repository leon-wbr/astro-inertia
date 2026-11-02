import { describe, expect, it } from "vitest";
import type { AstroComponent, ComponentLoader } from "./options.js";
import { ComponentNotFoundError, componentName, createResolver, normalizeName } from "./resolver.js";

const component = (label: string): AstroComponent => Object.assign(() => label, { label });
const loader =
  (label: string): ComponentLoader =>
  () =>
    Promise.resolve({ default: component(label) });

const glob = {
  "/src/pages-inertia/Home.astro": loader("home"),
  "/src/pages-inertia/Users/Index.astro": loader("users"),
  "/src/pages-inertia/layout/default.astro": loader("layout"),
  "/src/pages-inertia/Blog/index.astro": loader("blog"),
};

const label = (c: AstroComponent) => (c as unknown as { label: string }).label;

describe("componentName", () => {
  it("strips the directory and extension", () => {
    expect(componentName("/src/pages-inertia/Users/Index.astro", "src/pages-inertia")).toBe("Users/Index");
    expect(componentName("./src/pages-inertia/Home.astro", "./src/pages-inertia/")).toBe("Home");
    expect(componentName("/src/other/Home.astro", "src/pages-inertia")).toBeUndefined();
  });
});

describe("normalizeName", () => {
  it("trims slashes and refuses traversal", () => {
    expect(normalizeName("/Users/Index/")).toBe("Users/Index");
    expect(normalizeName("../secret")).toBeUndefined();
    expect(normalizeName("")).toBeUndefined();
  });
});

describe("createResolver", () => {
  const resolver = createResolver(glob, "src/pages-inertia");

  it("resolves by path", async () => {
    expect(label(await resolver.resolve("Home"))).toBe("home");
    expect(label(await resolver.resolve("Users/Index"))).toBe("users");
    expect(label(await resolver.resolve("layout/default"))).toBe("layout");
  });

  it("accepts dot separators and index files", async () => {
    expect(label(await resolver.resolve("Users.Index"))).toBe("users");
    expect(label(await resolver.resolve("Blog"))).toBe("blog");
  });

  it("lists the names it knows", () => {
    expect(resolver.names()).toEqual(["Blog/index", "Home", "Users/Index", "layout/default"]);
  });

  it("throws a clear error for a missing component", async () => {
    const error = await resolver.resolve("Missing/Page").catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ComponentNotFoundError);
    expect((error as Error).message).toContain('no component "Missing/Page"');
    expect((error as Error).message).toContain("src/pages-inertia/Missing/Page.astro");
  });

  it("refuses path traversal", async () => {
    await expect(resolver.resolve("../Home")).rejects.toBeInstanceOf(ComponentNotFoundError);
  });

  it("asks a custom resolver first and falls back to the glob", async () => {
    const custom = createResolver(glob, "src/pages-inertia", (name) =>
      name === "Welcome" ? { default: component("welcome") } : name === "Bare" ? component("bare") : undefined,
    );
    expect(label(await custom.resolve("Welcome"))).toBe("welcome");
    expect(label(await custom.resolve("Bare"))).toBe("bare");
    expect(label(await custom.resolve("Home"))).toBe("home");
  });
});
