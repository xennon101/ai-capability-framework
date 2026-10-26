import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { PassThrough } from "node:stream";
import { gzipSync } from "node:zlib";
import Ajv2020 from "ajv/dist/2020.js";
import { Address4, Address6 } from "ip-address";
import { SourceMapConsumer, SourceMapGenerator } from "source-map-js";
import { z } from "zod";
import { parse } from "yaml";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);

describe("dependency security regressions", () => {
  it("uses explicit proxy trust and rejects malformed mapped-address ranges", () => {
    const proxy = require("proxy-addr") as {
      (request: unknown, trust: unknown): string;
      compile(ranges: string[]): (address: string) => boolean;
    };
    const trust = proxy.compile(["127.0.0.1/8", "::1/128"]);
    expect(trust("::ffff:127.0.0.1")).toBe(true);
    expect(trust("203.0.113.9")).toBe(false);
    expect(proxy({ socket: { remoteAddress: "203.0.113.9" }, headers: { "x-forwarded-for": "127.0.0.1" } }, trust)).toBe("203.0.113.9");
    expect(() => proxy.compile(["::ffff:127.0.0.1/129"])).toThrow();
    expect(() => proxy.compile(["127.0.0.1/not-a-mask"])).toThrow();
  });

  it("keeps IP families distinct and handles bounded malformed zone identifiers", () => {
    expect(new Address4("0.0.0.1").isInSubnet(new Address6("::/0"))).toBe(false);
    expect(new Address6("::1").isInSubnet(new Address4("0.0.0.0/0"))).toBe(false);
    expect(Address4.isValid("010.0.0.1")).toBe(false);
    expect(Address6.isValid("::1" + "%".repeat(64) + "\n")).toBe(false);
    expect(Address6.fromAddress4Nat64("192.0.2.33").toAddress4Nat64()?.correctForm()).toBe("192.0.2.33");
  });

  it("handles a small compressed JSON body and trailing compressed bytes without an unhandled stream error", async () => {
    const bodyParser = require("body-parser") as { json(options: { limit: number }): (request: unknown, response: unknown, next: (error?: unknown) => void) => void };
    for (const trailing of [Buffer.alloc(0), Buffer.from("trailing")]) {
      const bytes = Buffer.concat([gzipSync('{"synthetic":true}'), trailing]);
      const request = Object.assign(new PassThrough(), {
        headers: { "content-type": "application/json", "content-encoding": "gzip", "content-length": String(bytes.length) },
        body: undefined as unknown
      });
      const error = await new Promise<unknown>((resolve) => {
        bodyParser.json({ limit: 128 })(request, {}, resolve);
        request.end(bytes);
      });
      if (trailing.length === 0) {
        expect(error).toBeUndefined();
        expect(request.body).toEqual({ synthetic: true });
      } else expect(error).toBeInstanceOf(Error);
    }
  });

  it("round-trips bounded source maps and rejects malformed mappings", () => {
    const generator = new SourceMapGenerator({ file: "generated.js" });
    generator.addMapping({ source: "input.js", original: { line: 1, column: 0 }, generated: { line: 1, column: 0 } });
    const consumer = new SourceMapConsumer(generator.toString());
    expect(consumer.originalPositionFor({ line: 1, column: 0 })).toMatchObject({ source: "input.js", line: 1, column: 0 });
    expect(() => new SourceMapConsumer({ version: 3, sources: ["input.js"], names: [], mappings: "!" }).originalPositionFor({ line: 1, column: 0 })).toThrow();
  });

  it("audits full and production trees for both coordinated packages", () => {
    const workflow = parse(readFileSync(".github/workflows/security.yml", "utf8"));
    const commands = workflow.jobs.security.steps.map((step: { run?: string }) => step.run).filter(Boolean);
    for (const prefix of ["npm", "npm --prefix agent-skills"]) {
      expect(commands).toContain(`${prefix} audit --audit-level=high`);
      expect(commands).toContain(`${prefix} audit --omit=dev --audit-level=high`);
    }
    const pkg = JSON.parse(readFileSync("package.json", "utf8"));
    expect(pkg.peerDependencies["@modelcontextprotocol/sdk"]).toBe(">=1.32.0");
    expect(pkg.peerDependenciesMeta["@modelcontextprotocol/sdk"].optional).toBe(true);
    expect(pkg.dependencies["@modelcontextprotocol/sdk"]).toBeUndefined();
  });
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
