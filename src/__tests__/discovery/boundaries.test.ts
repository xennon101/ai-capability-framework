import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

async function importGraph(entry: string, seen = new Set<string>()): Promise<Set<string>> {
  const file = path.resolve(entry);
  if (seen.has(file)) return seen;
  seen.add(file);
  const source = await readFile(file, "utf8");
  const imports = [...source.matchAll(/\b(?:from|import)\s*["'](\.[^"']+)["']/gu)];
  for (const match of imports) {
    const specifier = match[1]!;
    if (specifier.endsWith(".js")) await importGraph(path.resolve(path.dirname(file), specifier), seen);
  }
  return seen;
}

describe("discovery phase-one package boundaries", () => {
  it("keeps discovery implementations outside the root and runtime static import graphs", async () => {
    for (const entry of ["dist/index.js", "dist/runtime/index.js"]) {
      const files = await importGraph(entry);
      expect(files.size).toBeGreaterThan(1);
      expect([...files].filter(file => file.replaceAll("\\", "/").includes("/dist/discovery/"))).toEqual([]);
      for (const file of files) {
        const source = await readFile(file, "utf8");
        expect(source).not.toMatch(/(?:from|import)\s*["'](?:openai|@anthropic-ai\/sdk|@google\/genai|@aws-sdk\/|@modelcontextprotocol\/sdk)/u);
      }
    }
  });

  it("exports eligibility from runtime while keeping discovery and its schema validator out of root exports", async () => {
    const root = await import("../../../dist/index.js") as Record<string, unknown>;
    const runtime = await import("../../../dist/runtime/index.js") as Record<string, unknown>;
    const metadata = JSON.parse(await readFile("package.json", "utf8"));
    expect(runtime.filterEligibleCapabilities).toEqual(expect.any(Function));
    expect(root.filterEligibleCapabilities).toBeUndefined();
    expect(root.resolveDiscoveryMetadata).toBeUndefined();
    expect(root.validateDiscoveryMetadata).toBeUndefined();
    expect(metadata.exports["./discovery"]).toEqual({ types: "./dist/discovery/index.d.ts", import: "./dist/discovery/index.js" });
    expect(metadata.exports["./schemas/discovery/embedding-index.schema.json"]).toBe("./schemas/discovery/embedding-index.schema.json");
  });

  it("keeps the internal discovery graph free of provider SDK imports", async () => {
    const files = await importGraph("dist/discovery/index.js");
    for (const file of files) {
      const source = await readFile(file, "utf8");
      expect(source).not.toMatch(/(?:from|import)\s*["'](?:openai|@anthropic-ai\/sdk|@google\/genai|@aws-sdk\/|@modelcontextprotocol\/sdk)/u);
    }
  });
});

