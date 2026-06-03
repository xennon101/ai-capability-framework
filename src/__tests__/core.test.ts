import path from "node:path";
import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import {
  buildRegistry,
  decideCapability,
  formatInspection,
  inspectRegistry,
  loadManifests,
  runCli,
  validateManifests,
  type DecisionRequest,
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

describe("AICF decision control plane", () => {
  it("allows a read capability select decision", async () => {
    const registry = await loadValidRegistry();
    const result = decideCapability(registry, {
      capabilityId: "support.ticket.get",
      operation: "select",
      args: {
        ticket_id: "TCK-1001"
      },
      context: {
        autonomyTier: "A1",
        permissions: ["ticket.read"]
      }
    });

    expect(result.status).toBe("allowed");
    expect(result.reasons).toEqual([]);
    expect(result.audit).toMatchObject({
      capabilityId: "support.ticket.get",
      operation: "select",
      status: "allowed"
    });
  });

  it("allows select eligibility without fact-dependent policy evidence", async () => {
    const registry = await loadValidRegistry();
    const result = decideCapability(registry, {
      capabilityId: "support.refund.prepare_case",
      operation: "select",
      context: {
        autonomyTier: "A2",
        permissions: ["refund.case.create", "ticket.read"]
      }
    });

    expect(result.status).toBe("allowed");
    expect(result.reasons).toEqual([]);
  });

  it("denies when permissions are missing", async () => {
    const registry = await loadValidRegistry();
    const result = decideCapability(registry, {
      capabilityId: "support.ticket.get",
      operation: "select",
      context: {
        autonomyTier: "A1",
        permissions: []
      }
    });

    expect(result.status).toBe("denied");
    expect(result.reasons).toContainEqual(expect.objectContaining({
      code: "missing_permission"
    }));
  });

  it("denies when requested autonomy exceeds the capability tier", async () => {
    const registry = await loadValidRegistry();
    const result = decideCapability(registry, {
      capabilityId: "support.ticket.get",
      operation: "select",
      context: {
        autonomyTier: "A2",
        permissions: ["ticket.read"]
      }
    });

    expect(result.status).toBe("denied");
    expect(result.reasons).toContainEqual(expect.objectContaining({
      code: "autonomy_exceeded"
    }));
  });

  it("requires approval for a refund prepare request over the threshold", async () => {
    const registry = await loadValidRegistry();
    const request = await readDecisionExample("support.refund.prepare_case.approval_required.json");

    const result = decideCapability(registry, request);

    expect(result.status).toBe("approval_required");
    expect(result.requiredApprovals).toContainEqual(expect.objectContaining({
      code: "approval_required",
      rule: "refund.amount_over_threshold"
    }));
  });

  it("denies when a deny fact is true", async () => {
    const registry = await loadValidRegistry();
    const result = decideCapability(registry, {
      capabilityId: "support.refund.prepare_case",
      operation: "prepare",
      args: {
        order_id: "ORD-2003",
        reason_code: "damaged_item",
        ticket_id: "TCK-1002"
      },
      context: {
        autonomyTier: "A2",
        permissions: ["refund.case.create", "ticket.read"]
      },
      facts: {
        "refund.order_not_refundable": {
          value: true,
          reason: "Synthetic order is outside the refundable window."
        }
      }
    });

    expect(result.status).toBe("denied");
    expect(result.reasons).toContainEqual(expect.objectContaining({
      code: "deny_rule_matched",
      rule: "refund.order_not_refundable"
    }));
  });

  it("fails closed when a deny fact is missing", async () => {
    const registry = await loadValidRegistry();
    const result = decideCapability(registry, {
      capabilityId: "support.refund.prepare_case",
      operation: "prepare",
      args: {
        order_id: "ORD-2003",
        reason_code: "damaged_item",
        ticket_id: "TCK-1002"
      },
      context: {
        autonomyTier: "A2",
        permissions: ["refund.case.create", "ticket.read"]
      }
    });

    expect(result.status).toBe("denied");
    expect(result.reasons).toContainEqual(expect.objectContaining({
      code: "missing_fact",
      rule: "refund.order_not_refundable"
    }));
  });

  it("denies commit without approval", async () => {
    const registry = await loadValidRegistry();
    const result = decideCapability(registry, {
      capabilityId: "support.refund.commit_case",
      operation: "commit",
      args: {
        approval_id: "approval_example_1",
        prepared_action_id: "prepared_example_refund_1"
      },
      context: {
        autonomyTier: "A0",
        permissions: ["refund.case.commit"]
      },
      facts: {
        "refund.approval_missing_or_invalid": false
      },
      idempotencyKey: "idem_example_refund_commit_1"
    });

    expect(result.status).toBe("denied");
    expect(result.reasons).toContainEqual(expect.objectContaining({
      code: "approval_required"
    }));
  });

  it("denies commit without a required idempotency key", async () => {
    const registry = await loadValidRegistry();
    const result = decideCapability(registry, {
      capabilityId: "support.refund.commit_case",
      operation: "commit",
      args: {
        approval_id: "approval_example_1",
        prepared_action_id: "prepared_example_refund_1"
      },
      approval: {
        approvalId: "approval_example_1",
        approved: true
      },
      context: {
        autonomyTier: "A0",
        permissions: ["refund.case.commit"]
      },
      facts: {
        "refund.approval_missing_or_invalid": false
      }
    });

    expect(result.status).toBe("denied");
    expect(result.reasons).toContainEqual(expect.objectContaining({
      code: "idempotency_required"
    }));
  });

  it("allows commit with approval and idempotency key", async () => {
    const registry = await loadValidRegistry();
    const request = await readDecisionExample("support.refund.commit_case.allowed.json");

    const result = decideCapability(registry, request);

    expect(result.status).toBe("allowed");
    expect(result.audit).toMatchObject({
      capabilityId: "support.refund.commit_case",
      idempotencyKey: "idem_example_refund_commit_1",
      operation: "commit",
      status: "allowed"
    });
  });

  it("prints JSON from the decide CLI and exits zero for denied decisions", async () => {
    const stdout = createWritableBuffer();
    const stderr = createWritableBuffer();

    const exitCode = await runCli([
      "decide",
      "examples",
      "--request",
      "examples/support/decisions/support.refund.commit_case.denied_missing_approval.json"
    ], { stderr, stdout });
    const parsed = JSON.parse(stdout.value) as { status: string };

    expect(exitCode).toBe(0);
    expect(stderr.value).toBe("");
    expect(parsed.status).toBe("denied");
  });

  it("keeps idempotency in the generated CapabilityManifest type", async () => {
    const generatedTypes = await readFile("src/generated/manifest-types.ts", "utf8");
    const registry = await loadValidRegistry();
    const commitCapability = registry.capabilityById.get("support.refund.commit_case");

    expect(generatedTypes).toContain("idempotency?:");
    expect(commitCapability?.manifest.idempotency).toEqual({
      required: true,
      key_fields: ["prepared_action_id", "approval_id"]
    });
  });
});

async function loadValidRegistry() {
  const loaded = await loadManifests({ path: "examples" });
  const validation = validateManifests(loaded.manifests);
  if (loaded.errors.length > 0 || !validation.valid) {
    throw new Error("Expected public examples to load and validate.");
  }

  return buildRegistry(loaded.manifests);
}

async function readDecisionExample(fileName: string): Promise<DecisionRequest> {
  const content = await readFile(path.join("examples/support/decisions", fileName), "utf8");
  return JSON.parse(content) as DecisionRequest;
}

function createWritableBuffer(): { value: string; write(chunk: string): void } {
  return {
    value: "",
    write(chunk: string) {
      this.value += chunk;
    }
  };
}
