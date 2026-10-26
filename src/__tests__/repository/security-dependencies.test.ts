import { readFileSync } from "node:fs";
import Ajv2020 from "ajv/dist/2020.js";
import { z } from "zod";
import { parse } from "yaml";
import { describe, expect, it } from "vitest";

describe("dependency security regressions", () => {
  it("rejects an oversized constrained array before inspecting its elements", () => {
    let inspected = 0;
    const schema = z.array(z.string().refine(() => { inspected += 1; return true; })).max(2);
    expect(schema.safeParse(["a", "b", "c", "d"]).success).toBe(false);
    expect(inspected).toBe(0);
    expect(schema.safeParse(["a", "b"]).success).toBe(true);
    expect(inspected).toBe(2);
    expect(schema.safeParse([42]).success).toBe(false);
  });

  it("resolves ordinary schema IDs and relative references without a schema loader", () => {
    const ajv = new Ajv2020();
    ajv.addSchema({ $id: "https://example.com/schemas/value.json", type: "string" });
    const validate = ajv.compile({
      $id: "https://example.com/schemas/root.json", type: "object",
      properties: { value: { $ref: "./value.json" } }, required: ["value"], additionalProperties: false
    });
    expect(ajv.opts.loadSchema).toBeUndefined();
    expect(validate({ value: "example" })).toBe(true);
    expect(validate({ value: 42 })).toBe(false);
  });

  it("keeps encoded schemes invalid and canonicalizes equivalent reference hosts", () => {
    const resolver = new Ajv2020().opts.uriResolver!;
    const encoded = resolver.parse("%6Aavascript:example");
    expect(encoded.error).toBeTruthy();
    expect(encoded.scheme).not.toBe("javascript");
    expect(resolver.parse("//%41.example.com").host).toBe(resolver.parse("//a.example.com").host);
    expect(resolver.parse("https://a@b@example.com/").error).toBeTruthy();
  });

  it("preserves relative-reference meaning through parse and serialization", () => {
    const resolver = new Ajv2020().opts.uriResolver!;
    const base = "https://example.com/schemas/root.json";
    for (const ref of ["../value.json", "nested/../value.json"])
      expect(resolver.resolve(base, resolver.serialize(resolver.parse(ref)))).toBe(resolver.resolve(base, ref));
  });

  it("keeps the supported Zod security minimum optional", () => {
    const pkg = JSON.parse(readFileSync("package.json", "utf8"));
    const minimum = /^>=(\d+)\.(\d+)\.(\d+)$/u.exec(pkg.peerDependencies.zod);
    expect(minimum).not.toBeNull();
    const [major, minor, patch] = minimum!.slice(1).map(Number);
    expect(major! > 4 || (major === 4 && (minor! > 6 || (minor === 6 && patch! >= 6)))).toBe(true);
    expect(pkg.peerDependenciesMeta.zod.optional).toBe(true);
    expect(pkg.dependencies.zod).toBeUndefined();
  });

  it("schedules reviewed dependency PRs for both packages without widening ranges", () => {
    const config = parse(readFileSync(".github/dependabot.yml", "utf8"));
    expect(config.version).toBe(2);
    expect(config.updates.map((entry: { directory: string }) => entry.directory)).toEqual(["/", "/agent-skills"]);
    for (const entry of config.updates) {
      expect(entry["package-ecosystem"]).toBe("npm");
      expect(entry.schedule).toEqual({ interval: "weekly", day: "monday", time: "05:00", timezone: "Europe/London" });
      expect(entry["open-pull-requests-limit"]).toBe(2);
      expect(entry["versioning-strategy"]).toBe("increase");
      expect(entry.groups["patch-and-minor"]).toEqual({
        "applies-to": "version-updates", patterns: ["*"], "update-types": ["minor", "patch"]
      });
      expect(entry["target-branch"]).toBeUndefined();
    }
  });
});
