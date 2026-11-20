import { describe, expect, it } from "vitest";
import { deferredKeys, InvalidPageError, parsePage } from "./protocol.js";

describe("parsePage", () => {
  it("accepts a minimal page object and adds empty errors", () => {
    const page = parsePage({ component: "Home", props: { title: "Hi" }, url: "/", version: "abc" });
    expect(page).toEqual({ component: "Home", props: { title: "Hi", errors: {} }, url: "/", version: "abc" });
  });

  it("keeps v3 fields", () => {
    const page = parsePage({
      component: "Users/Index",
      props: { errors: { name: "Required" } },
      url: "/users?page=2",
      version: 7,
      encryptHistory: true,
      clearHistory: false,
      mergeProps: ["users"],
      deepMergeProps: ["meta"],
      prependProps: ["log"],
      matchPropsOn: ["users.id"],
      deferredProps: { default: ["stats"], sidebar: ["activity"] },
      onceProps: { plans: { prop: "plans", expiresAt: null } },
      scrollProps: { users: { pageName: "page", nextPage: 3 } },
      flash: { success: "Saved" },
    });
    expect(page.version).toBe("7");
    expect(page.encryptHistory).toBe(true);
    expect(page.mergeProps).toEqual(["users"]);
    expect(page.deferredProps).toEqual({ default: ["stats"], sidebar: ["activity"] });
    expect(page.onceProps?.plans?.expiresAt).toBeNull();
    expect(page.props.errors).toEqual({ name: "Required" });
    expect(page.flash).toEqual({ success: "Saved" });
  });

  it("accepts a null or missing version", () => {
    expect(parsePage({ component: "A", props: {}, url: "/" }).version).toBeNull();
    expect(parsePage({ component: "A", props: {}, url: "/", version: null }).version).toBeNull();
  });

  it.each([
    [null, /JSON object/],
    [[], /JSON object/],
    [{ props: {}, url: "/" }, /component/],
    [{ component: "", props: {}, url: "/" }, /component/],
    [{ component: "A", props: [], url: "/" }, /props/],
    [{ component: "A", props: {}, url: 1 }, /url/],
    [{ component: "A", props: {}, url: "/", version: {} }, /version/],
    [{ component: "A", props: { errors: [] }, url: "/" }, /errors/],
    [{ component: "A", props: {}, url: "/", mergeProps: "x" }, /mergeProps/],
    [{ component: "A", props: {}, url: "/", deferredProps: { default: [1] } }, /deferredProps/],
  ])("rejects %j", (input, message) => {
    expect(() => parsePage(input)).toThrow(InvalidPageError);
    expect(() => parsePage(input)).toThrow(message);
  });
});

describe("deferredKeys", () => {
  const page = { deferredProps: { default: ["stats", "chart"], sidebar: ["activity"] } };
  it("expands groups", () => {
    expect(deferredKeys(page, "default")).toEqual(["stats", "chart"]);
    expect(deferredKeys(page, ["default", "sidebar"])).toEqual(["stats", "chart", "activity"]);
  });
  it("takes plain keys and comma lists", () => {
    expect(deferredKeys(page, "stats")).toEqual(["stats"]);
    expect(deferredKeys(page, "stats, activity")).toEqual(["stats", "activity"]);
    expect(deferredKeys({}, "x")).toEqual(["x"]);
  });
  it("drops empty entries of a comma list", () => {
    expect(deferredKeys({}, "a,, b ,")).toEqual(["a", "b"]);
  });
});

describe("parsePage edge cases", () => {
  const base = { component: "A", props: {}, url: "/" };

  it("throws errors that name themselves InvalidPageError", () => {
    expect(() => parsePage(null)).toThrow(expect.objectContaining({ name: "InvalidPageError" }));
  });

  it.each([
    ["a string", { ...base, props: "x" }],
    ["null", { ...base, props: null }],
  ])("rejects props that are %s", (_, input) => {
    expect(() => parsePage(input)).toThrow(/props/);
  });

  it("rejects a string array with a non-string among strings", () => {
    expect(() => parsePage({ ...base, mergeProps: ["a", 1] })).toThrow(/mergeProps/);
  });

  it("drops string-array fields that are null", () => {
    const page = parsePage({ ...base, mergeProps: null, rescuedProps: null });
    expect("mergeProps" in page).toBe(false);
    expect("rescuedProps" in page).toBe(false);
  });

  it("rejects deferredProps that is not an object", () => {
    expect(() => parsePage({ ...base, deferredProps: "stats" })).toThrow("page.deferredProps must be an object");
  });
});
