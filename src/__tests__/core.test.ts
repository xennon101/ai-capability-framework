import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildRegistry,
  formatInspection,
  inspectRegistry,
  loadManifests,
  runCli,
  validateManifests,
  type LoadedManifest
} from "../index.js";

describe("AICF core", () => {
  it("loads and validates the public examples", async () => {
    const loaded = await loadManifests({ path: "examples" });
    const validation = validateManifests(loaded.manifests);

    expect(loaded.errors).toEqual([]);
    expect(validation.errors).toEqual([]);
    expect(validation.valid).toBe(true);
    expect(loaded.manifests).toHaveLength(8);
  });

  it("builds a registry and inspect summary for the public examples", async () => {
    const loaded = await loadManifests({ path: "examples" });
    const registry = buildRegistry(loaded.manifests);
    const inspection = inspectRegistry(registry);
    const output = formatInspection(inspection);

    expect(registry.capabilityById.has("support.ticket.get")).toBe(true);
    expect(registry.entityById.has("Ticket")).toBe(true);
    expect(registry.evalById.has("support.refund.prepare_case.valid")).toBe(true);
    expect(inspection.counts).toEqual({
      capabilities: 3,
      entities: 2,
      evals: 3,
      manifests: 8
    });
    expect(output).toContain("support.refund.prepare_case");
    expect(output).toContain("Warnings:\n- none");
  });

  it("reports schema validation failures with structured diagnostics", async () => {
    const invalidManifest = {
      absolutePath: path.resolve("test/invalid/capabilities/invalid.yaml"),
      kind: "capability",
      manifest: {
        id: "support.invalid.missing_required_fields"
      },
      path: "test/invalid/capabilities/invalid.yaml"
    } as LoadedManifest;

    const validation = validateManifests([invalidManifest]);

    expect(validation.valid).toBe(false);
    expect(validation.errors.some((error) => error.code === "schema")).toBe(true);
    expect(validation.errors[0]).toMatchObject({
      kind: "capability",
      path: "test/invalid/capabilities/invalid.yaml"
    });
  });

  it("reports missing eval references", async () => {
    const loaded = await loadManifests({ path: "examples" });
    const capability = loaded.manifests.find(
      (manifest) => manifest.kind === "capability" && manifest.manifest.id === "support.refund.prepare_case"
    );
    if (!capability) {
      throw new Error("Expected support.refund.prepare_case example capability.");
    }

    const missingReference = {
      ...capability,
      manifest: {
        ...capability.manifest,
        evals: {
          golden: ["../evals/missing.yaml"]
        }
      }
    } as LoadedManifest;

    const validation = validateManifests([
      ...loaded.manifests.filter((manifest) => manifest !== capability),
      missingReference
    ]);

    expect(validation.valid).toBe(false);
    expect(validation.errors).toContainEqual(expect.objectContaining({
      code: "missing_reference",
      id: "support.refund.prepare_case"
    }));
  });

  it("reports duplicate IDs within the same manifest kind", async () => {
    const loaded = await loadManifests({ path: "examples" });
    const capability = loaded.manifests.find(
      (manifest) => manifest.kind === "capability" && manifest.manifest.id === "support.ticket.get"
    );
    if (!capability) {
      throw new Error("Expected support.ticket.get example capability.");
    }

    const duplicate = {
      ...capability,
      absolutePath: path.resolve("test/duplicate/capabilities/support.ticket.get.yaml"),
      path: "test/duplicate/capabilities/support.ticket.get.yaml"
    } as LoadedManifest;

    const validation = validateManifests([...loaded.manifests, duplicate]);

    expect(validation.valid).toBe(false);
    expect(validation.errors).toContainEqual(expect.objectContaining({
      code: "duplicate_id",
      id: "support.ticket.get"
    }));
  });
});

describe("AICF CLI", () => {
  it("validates examples with exit code 0", async () => {
    const stdout = createWritableBuffer();
    const stderr = createWritableBuffer();

    const exitCode = await runCli(["validate", "examples"], { stderr, stdout });

    expect(exitCode).toBe(0);
    expect(stdout.value).toContain("Validated 8 manifest(s).");
    expect(stderr.value).toBe("");
  });

  it("inspects examples with readable counts and IDs", async () => {
    const stdout = createWritableBuffer();
    const stderr = createWritableBuffer();

    const exitCode = await runCli(["inspect", "examples"], { stderr, stdout });

    expect(exitCode).toBe(0);
    expect(stdout.value).toContain("Manifests: 8 (3 capabilities, 2 entities, 3 evals)");
    expect(stdout.value).toContain("support.ticket.get");
    expect(stdout.value).toContain("Warnings:\n- none");
    expect(stderr.value).toBe("");
  });
});

function createWritableBuffer(): { value: string; write(chunk: string): void } {
  return {
    value: "",
    write(chunk: string) {
      this.value += chunk;
    }
  };
}
