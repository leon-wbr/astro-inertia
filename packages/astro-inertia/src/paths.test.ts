import { describe, expect, it } from "vitest";
import { trimSlashes, trimTrailingSlashes } from "./paths.js";

describe("trimSlashes", () => {
  it.each([
    ["src/pages-inertia", "src/pages-inertia"],
    ["./src/pages-inertia/", "src/pages-inertia"],
    ["/src/pages-inertia", "src/pages-inertia"],
    ["//src/pages-inertia//", "src/pages-inertia"],
    [".//src/pages-inertia", "src/pages-inertia"],
    ["src/a/b///", "src/a/b"],
    ["", ""],
    ["/", ""],
    ["./", ""],
  ])("turns %j into %j", (input, expected) => {
    expect(trimSlashes(input)).toBe(expected);
  });

  it("keeps inner slashes and a leading dot that is part of a name", () => {
    expect(trimSlashes(".hidden/dir")).toBe(".hidden/dir");
  });
});

describe("trimTrailingSlashes", () => {
  it.each([
    ["/site/", "/site"],
    ["/site///", "/site"],
    ["/site", "/site"],
    ["/", ""],
    ["", ""],
  ])("turns %j into %j", (input, expected) => {
    expect(trimTrailingSlashes(input)).toBe(expected);
  });

  it("keeps leading slashes", () => {
    expect(trimTrailingSlashes("//a/")).toBe("//a");
  });
});
