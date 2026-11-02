import { describe, expect, expectTypeOf, it } from "vitest";
import { definePage, errorFor } from "./define-page.js";
import type { Page } from "./protocol.js";

describe("definePage", () => {
  const page: Page<{ title: string }> = {
    component: "Home",
    props: { title: "Hi", errors: {} },
    url: "/",
    version: null,
  };

  it("splits props and page, and types them", () => {
    const { props, page: p } = definePage<{ title: string }>({ props: { title: "Hi", errors: {}, page } });
    expect(props).toEqual({ title: "Hi", errors: {} });
    expect(p).toBe(page);
    expectTypeOf(props.title).toEqualTypeOf<string>();
    expectTypeOf(props.errors).toEqualTypeOf<Record<string, string | string[]>>();
  });

  it("fills in errors", () => {
    expect(definePage({ props: { page } }).props.errors).toEqual({});
  });

  it("throws outside an Inertia page", () => {
    expect(() => definePage({ props: {} })).toThrow(/outside an Inertia page/);
  });
});

describe("errorFor", () => {
  it("returns the first message", () => {
    expect(errorFor({ a: "x", b: ["y", "z"] }, "a")).toBe("x");
    expect(errorFor({ a: "x", b: ["y", "z"] }, "b")).toBe("y");
    expect(errorFor(undefined, "a")).toBeUndefined();
  });
});
