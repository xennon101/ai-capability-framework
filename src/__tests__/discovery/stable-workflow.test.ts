import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { validateManifests, type CapabilityManifest } from "../../index.js";
import { extractGettingStartedFiles } from "../../../scripts/check-getting-started.mjs";

describe("stable workflow onboarding", () => {
  it("publishes a complete valid capability and uses existing public imports", async () => {
    const text = await readFile("docs/getting-started/provider-neutral-quickstart.md", "utf8");
    const { manifest, application } = extractGettingStartedFiles(text);
    const result = validateManifests([{ kind: "capability", path: "capabilities/ticket.json", absolutePath: "/synthetic/capabilities/ticket.json", manifest: manifest as CapabilityManifest }]);
    expect(result.errors).toEqual([]);
    for (const moduleName of ["ai-capability-framework", "ai-capability-framework/discovery", "ai-capability-framework/runtime", "ai-capability-framework/openai"]) {
      const module = await import(moduleName);
      const imports = new RegExp('import \\{([^}]+)\\} from "' + moduleName.replaceAll("/", "\\/") + '"', "u").exec(application);
      expect(imports).not.toBeNull();
      for (const name of imports![1]!.split(",").map(value => value.trim()).filter(Boolean)) expect(module).toHaveProperty(name);
    }
    expect(application).not.toMatch(/\.\.\/|loadRegistryFromPath|buildCapabilityEmbeddingIndex|SelectionModelClient/u);
    expect(text).not.toContain("npm run build");
  });

  it("refuses incomplete or ambiguous tutorial extraction", () => {
    expect(() => extractGettingStartedFiles("no files")).toThrow();
    expect(() => extractGettingStartedFiles('```json\n{}\n```\n```json\n{}\n```\n```js\nexport {};\n```')).toThrow();
  });

  it("limits the compatibility promise to named members and preserves advanced labels", async () => {
    const text = (await readFile("docs/api/stable-workflow.md", "utf8")).replace(/\s+/gu, " ");
    expect(text).toContain("stable public contract");
    expect(text).toContain("requires a major version");
    expect(text).toContain("not every export");
    expect(text).toContain("experimental and opt-in");
    expect(text).toContain("release-candidate public");
    const discovery = await readFile("docs/discovery.md", "utf8");
    expect(discovery).not.toContain("Until a release includes");
    expect(discovery).toContain("api/stable-workflow.md");
  });
});
