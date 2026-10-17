import { describe, expect, it } from "vitest";
import { loadManifests, validateManifests, type CapabilityManifest } from "../../index.js";
import { resolveDiscoveryMetadata } from "../../discovery/metadata.js";
import { DiscoveryError } from "../../discovery/diagnostics.js";
import { validateDiscoveryMetadata } from "../../validator.js";

const loaded = await loadManifests({ path: "examples/support" });
const source = loaded.manifests.find((entry) => entry.kind === "capability" && entry.manifest.id === "support.ticket.get")!;
const manifest = source.manifest as CapabilityManifest;

function withMetadata(discovery: unknown): CapabilityManifest {
  return { ...structuredClone(manifest), extensions: { discovery } };
}

describe("optional discovery metadata", () => {
  it("preserves legacy manifests and unrelated extensions without applying new summary limits", () => {
    const legacy = { ...manifest, summary: "x".repeat(501), extensions: { other: { enabled: true } } };
    expect(validateManifests([{ ...source, kind: "capability", manifest: legacy }]).valid).toBe(true);
    expect(resolveDiscoveryMetadata(legacy)).toEqual({ schemaVersion: "1.0", summary: legacy.summary, aliases: [] });
  });

  it("resolves authored fields and deduplicates normalized aliases without changing display or input", () => {
    const candidate = withMetadata({ schema_version: "1.0", summary: "Read a ticket.", aliases: [
      " Ticket  Details ", "ticket details", "ＴＩＣＫＥＴ details", "case status"
    ] });
    const before = structuredClone(candidate);
    expect(resolveDiscoveryMetadata(candidate)).toEqual({
      schemaVersion: "1.0", summary: "Read a ticket.", aliases: [" Ticket  Details ", "case status"]
    });
    expect(candidate).toEqual(before);
    expect(validateManifests([{ ...source, kind: "capability", manifest: candidate }]).valid).toBe(true);
  });

  it("accepts the version-only extension and exact documented boundaries", () => {
    expect(resolveDiscoveryMetadata(withMetadata({ schema_version: "1.0" })).summary).toBe(manifest.summary);
    expect(validateDiscoveryMetadata({
      schema_version: "1.0", summary: "x".repeat(500), aliases: Array.from({ length: 32 }, () => "x".repeat(120))
    })).toEqual([]);
  });

  it.each([
    null, false, [], "metadata", {}, { schema_version: "2.0" },
    { schema_version: "1.0", summary: "" }, { schema_version: "1.0", summary: " \t\n\u00a0" },
    { schema_version: "1.0", summary: 12 }, { schema_version: "1.0", summary: "x".repeat(501) },
    { schema_version: "1.0", aliases: "ticket" }, { schema_version: "1.0", aliases: [null] },
    { schema_version: "1.0", aliases: [" "] }, { schema_version: "1.0", aliases: ["x".repeat(121)] },
    { schema_version: "1.0", aliases: Array.from({ length: 33 }, () => "ticket") },
    { schema_version: "1.0", unknown: true }
  ].map(value => [value]))("rejects malformed authored metadata without falling back: %j", (discovery) => {
    const candidate = withMetadata(discovery);
    const result = validateManifests([{ ...source, kind: "capability", manifest: candidate }]);
    expect(result.valid).toBe(false);
    expect(result.errors).toContainEqual(expect.objectContaining({
      code: "schema", id: manifest.id, kind: "capability", path: source.path,
      details: expect.objectContaining({ instancePath: expect.stringMatching(/^\/extensions\/discovery/) })
    }));
    expect(() => resolveDiscoveryMetadata(candidate)).toThrow(DiscoveryError);
  });

  it("reports exact instance paths and does not leak a prior validation failure", () => {
    const errors = validateDiscoveryMetadata({ schema_version: "1.0", aliases: ["ticket", 12] });
    expect(errors[0]?.instancePath).toBe("/extensions/discovery/aliases/1");
    expect(validateDiscoveryMetadata({ schema_version: "1.0" })).toEqual([]);
    expect(errors[0]?.instancePath).toBe("/extensions/discovery/aliases/1");
  });

  it("does not throw on otherwise malformed capability manifests", () => {
    for (const value of [null, {}, { extensions: null }, { extensions: "invalid" }]) {
      expect(() => validateManifests([{ ...source, manifest: value } as never])).not.toThrow();
    }
  });
});

