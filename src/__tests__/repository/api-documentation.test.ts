import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { apiDocumentationFailures, requiredApiTypes } from "../../../scripts/check-api-docs.mjs";

describe("public API documentation references", () => {
  it("requires the exported types instead of hiding missing references", () => {
    const config = JSON.parse(readFileSync("typedoc.json", "utf8"));
    expect(config.treatWarningsAsErrors).toBe(true);
    expect(config.validation?.notExported).not.toBe(false);
    expect(config.intentionallyNotExported ?? []).toEqual([]);
    expect(config.entryPoints).toContain("src/evals-live/index.ts");
    const complete = { children: Object.entries(requiredApiTypes).map(([name, types]) => ({ name, children: types.map(name => ({ name })) })) };
    expect(apiDocumentationFailures(complete)).toEqual([]);
    for (const item of complete.children) for (const type of item.children) {
      const incomplete = structuredClone(complete);
      const module = incomplete.children.find(m => m.name === item.name)!;
      module.children = module.children.filter(child => child.name !== type.name);
      expect(apiDocumentationFailures(incomplete)).toContain(`Missing documented public type: ${item.name}.${type.name}`);
    }
  });
});
