import { describe, expect, it } from "vitest";
import { generateTypes } from "./codegen.js";

describe("generateTypes", () => {
  it("maps component names to props interfaces", async () => {
    const output = await generateTypes({
      title: "Some backend",
      type: "object",
      properties: {
        "Users/Index": {
          type: "object",
          properties: { users: { type: "array", items: { type: "string" } } },
          required: ["users"],
        },
        Home: { type: "object", properties: { title: { type: "string" } } },
      },
    });
    expect(output).toContain('declare module "astro-inertia"');
    expect(output).toContain("interface InertiaPages extends InertiaPagesSchema {}");
    expect(output).toContain("export interface InertiaPagesSchema {");
    expect(output).toMatch(/"Users\/Index": \{\s*users: string\[\];?\s*\}/);
    expect(output).toMatch(/Home: \{\s*title\?: string;?\s*\}/);
    expect(output).not.toContain("[k: string]");
  });

  it("rejects a schema that is not an object of components", async () => {
    await expect(generateTypes({ type: "string" })).rejects.toThrow(/component names/);
  });
});
